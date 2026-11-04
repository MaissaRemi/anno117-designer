import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { islandById, WORLDS } from "../data/islands";
import { dieux, nomDuDieu } from "../economy/dieux";
import {
  LIBELLES_OBJECTIF, LIBELLES_PROPRIETE, nouvelleConfiguration, palierParDefaut, paliersDeLaProvince, provinceDe,
  type ConfigurationMonde, type IleDuMonde, type ObjectifPrincipale,
} from "../monde/configuration";
import { fertilitesLisibles } from "../monde/fertilites";
import { depotMondes, lireExport, type DepotMondes } from "../monde/stockage";
import { calculerMonde, type Executeurs } from "../monde/calcul";
import { configurationDepuisPartie, joueursDeLaPartie, lirePartie, type PartieLue } from "../monde/sauvegarde/partie";
import { Modal } from "./Modal";
import { runIslandPlan } from "../optimizer/runIslandPlan";
import { runPlanifier } from "../commande/runPlanifier";
import { AssistantMonde, type EtapeAssistant } from "./monde/AssistantMonde";
import { ResultatMondeVue } from "./monde/ResultatMondeVue";
import { IslandThumb } from "./components/IslandThumb";
import { RoadTypeSelect } from "./components/RoadTypeSelect";

/**
 * ONGLET MONDE — la planification globale d'une partie.
 *
 * Conception : `docs/superpowers/specs/2026-10-30-planification-globale-design.md`. Les
 * configurations et leur assistant (étape 1) ; les rôles des îles, les réglages et le calcul du
 * monde (étapes 2 et 3, `monde/calcul.ts`) : îles principales, production répartie sur les
 * autres îles à moi, flux entre îles, bilan. Les moteurs tournent dans des Web Workers, en
 * parallèle.
 */

type Assistant = { c: ConfigurationMonde; nouvelle: boolean; etape: EtapeAssistant };
type ChoixJoueur = { nom: string; partie: PartieLue; joueurs: ReturnType<typeof joueursDeLaPartie> };

const dateCourte = (iso: string) => new Date(iso).toLocaleString("fr", { dateStyle: "short", timeStyle: "short" });
const nomCourt = (ileId: string) => (islandById(ileId)?.name ?? ileId).replace(/ \((Roman|Celtic)\)$/, "");

function telecharger(nom: string, contenu: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(contenu, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nom.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "monde"}.monde.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MondeView() {
  const [depot, setDepot] = useState<DepotMondes | null>(null);
  const [liste, setListe] = useState<ConfigurationMonde[]>([]);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [calcul, setCalcul] = useState<{ texte: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choixJoueur, setChoixJoueur] = useState<ChoixJoueur | null>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const annulations = useRef(new Set<() => void>());
  useEffect(() => () => { for (const a of annulations.current) a(); }, []);
  const catalog = useStore((s) => s.catalog);

  const recharger = async (d: DepotMondes) => setListe(await d.lister());
  useEffect(() => {
    depotMondes().then(async (d) => { setDepot(d); await recharger(d); });
  }, []);

  const enregistrer = async (c: ConfigurationMonde) => {
    if (!depot) return;
    await depot.enregistrer(c);
    await recharger(depot);
    setOuverte(c.id);
  };
  const supprimer = async (c: ConfigurationMonde) => {
    if (!depot || !confirm(`Supprimer la configuration « ${c.nom} » ?`)) return;
    await depot.supprimer(c.id);
    if (ouverte === c.id) setOuverte(null);
    await recharger(depot);
  };
  /** Une partie lue devient une configuration : îles, fertilités, propriétaires, rotation. */
  const creerDepuisPartie = async (nom: string, p: PartieLue, moi?: number) => {
    const c = configurationDepuisPartie(nom, p, moi);
    await enregistrer(c);
    const aMoi = c.iles.filter((i) => i.propriete === "moi").length;
    setMessage(`Sauvegarde importée : ${c.iles.length} îles, dont ${aMoi} à toi. Choisis tes îles principales dans la fiche.`
      + (p.inconnues.length ? ` ${p.inconnues.length} île(s) absente(s) du catalogue, ignorée(s) : ${p.inconnues.join(", ")}.` : ""));
  };
  const importer = async (f: File) => {
    if (!depot) return;
    if (/\.a8s$/i.test(f.name)) {
      setMessage("Lecture de la sauvegarde…");
      try {
        const partie = await lirePartie(new Uint8Array(await f.arrayBuffer()));
        const nom = f.name.replace(/\.a8s$/i, "").trim() || "Partie importée";
        const joueurs = joueursDeLaPartie(partie);
        if (joueurs.length > 1) { setMessage(null); setChoixJoueur({ nom, partie, joueurs }); }
        else await creerDepuisPartie(nom, partie, joueurs[0]?.guid);
      } catch (e) {
        setMessage(`Sauvegarde illisible : ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const lues = lireExport(await f.text());
    for (const c of lues) await depot.enregistrer(c);
    await recharger(depot);
    setMessage(lues.length ? `${lues.length} configuration(s) importée(s)` : "Ce fichier ne contient aucune configuration lisible");
  };

  const c = liste.find((x) => x.id === ouverte);
  const modifier = (f: (c: ConfigurationMonde) => ConfigurationMonde) => {
    if (c) void enregistrer({ ...f(c), modifieLe: new Date().toISOString() });
  };
  const modifierIle = (cle: string, f: (i: IleDuMonde) => IleDuMonde) =>
    modifier((x) => ({ ...x, iles: x.iles.map((i) => (i.cle === cle ? f(i) : i)) }));

  /** Un moteur dans un Web Worker, annulable si l'on quitte l'onglet. */
  const enWorker = <T,>(lancer: () => { promise: Promise<T>; cancel: () => void }) => {
    const { promise, cancel } = lancer();
    annulations.current.add(cancel);
    return promise.finally(() => annulations.current.delete(cancel));
  };
  const calculer = async (cfg: ConfigurationMonde | undefined = c) => {
    if (!cfg) return;
    setErreur(null);
    setCalcul({ texte: "Îles principales…" });
    const executeurs: Executeurs = {
      principale: (req) => enWorker(() => runIslandPlan(req)),
      production: (req) => enWorker(() => runPlanifier(req)),
    };
    try {
      const resultat = await calculerMonde(cfg, {
        catalog, executeurs, precedent: cfg.resultat,
        parallelisme: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)),
        onProgres: (texte) => setCalcul({ texte }),
      });
      await enregistrer({ ...cfg, resultat });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setCalcul(null);
    }
  };
  /** Suggestion acceptée : l'île passe à moi, en île de production, et l'on recalcule — les îles
   *  inchangées sont reprises du calcul précédent. */
  const acheter = (cle: string) => {
    if (!c) return;
    const cfg: ConfigurationMonde = {
      ...c, modifieLe: new Date().toISOString(),
      iles: c.iles.map((i) => (i.cle === cle ? { ...i, propriete: "moi" as const, role: "auto" as const } : i)),
    };
    void enregistrer(cfg).then(() => calculer(cfg));
  };
  /** Suggestion refusée : l'île n'est pas à vendre, on ne la proposera plus. */
  const refuser = (cle: string) => modifierIle(cle, (i) => ({ ...i, propriete: "indisponible" }));
  const nbPrincipales = c?.iles.filter((i) => i.propriete === "moi" && i.role === "principale").length ?? 0;
  const perime = !!c?.resultat && c.modifieLe > c.resultat.calculeLe;

  return (
    <div className="monde-vue">
      <div className="monde-barre">
        <h3>🌍 Planification d'un monde</h3>
        <button type="button" className="primary" onClick={() => setAssistant({ c: nouvelleConfiguration(""), nouvelle: true, etape: 0 })}>
          + Nouvelle planification
        </button>
        <button type="button" onClick={() => fichier.current?.click()}
          title="Une configuration exportée (.json), ou une sauvegarde du jeu (.a8s) : ses îles, leurs fertilités et leurs propriétaires">
          Importer…
        </button>
        <input ref={fichier} type="file" accept=".json,application/json,.a8s" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importer(f); e.target.value = ""; }} />
      </div>
      {depot && !depot.persistant && (
        <div className="warn">Ce navigateur ne permet pas d'enregistrer (IndexedDB indisponible) : les configurations seront perdues au rechargement. Pense à les exporter.</div>
      )}
      {message && <div className="muted" style={{ margin: "4px 0" }}>{message}</div>}

      <div className="monde-contenu">
        <aside className="monde-liste">
          {!liste.length && <p className="muted">Aucune configuration. Commence par « Nouvelle planification ».</p>}
          {liste.map((x) => (
            <button key={x.id} type="button" className={`monde-carte${x.id === ouverte ? " active" : ""}`} onClick={() => setOuverte(x.id)}>
              <b>{x.nom}</b>
              <span className="muted">
                {x.iles.length} île(s) · {x.iles.filter((i) => i.propriete === "moi").length} à moi · {dateCourte(x.modifieLe)}
              </span>
            </button>
          ))}
        </aside>

        <section className="monde-detail">
          {!c && liste.length > 0 && <p className="muted">Choisis une configuration à gauche.</p>}
          {c && (
            <>
              <div className="monde-barre">
                <h3>{c.nom}</h3>
                <button type="button" onClick={() => setAssistant({ c, nouvelle: false, etape: 0 })}>Renommer</button>
                <button type="button" onClick={() => setAssistant({ c, nouvelle: false, etape: 1 })}>Îles et fertilités</button>
                <button type="button" onClick={() => setAssistant({ c, nouvelle: false, etape: 2 })}>Propriété</button>
                <button type="button" onClick={() => telecharger(c.nom, c)}>Exporter</button>
                <button type="button" className="btn-ghost" onClick={() => void supprimer(c)}>Supprimer</button>
              </div>
              <div className="monde-reglages">
                <label className="field">
                  <span>Les îles principales visent</span>
                  <select value={c.reglages.objectif} onChange={(e) => modifier((x) => ({ ...x, reglages: { ...x.reglages, objectif: e.target.value as ObjectifPrincipale } }))}>
                    {(Object.keys(LIBELLES_OBJECTIF) as ObjectifPrincipale[]).map((o) => <option key={o} value={o}>{LIBELLES_OBJECTIF[o]}</option>)}
                  </select>
                </label>
                <RoadTypeSelect value={c.reglages.routes} onChange={(t) => modifier((x) => ({ ...x, reglages: { ...x.reglages, routes: t } }))} />
                <label className="field" title="Recherche et objets : points de pourcentage ajoutés à la productivité de tous les ateliers, en plus du dieu de l'île.">
                  <span>Productivité (recherche, objets)</span>
                  <input type="number" step={5} value={c.reglages.productiviteGlobale}
                    onChange={(e) => modifier((x) => ({ ...x, reglages: { ...x.reglages, productiviteGlobale: Number(e.target.value) || 0 } }))} />
                </label>
              </div>

              {WORLDS.map((w) => {
                const iles = c.iles.filter((i) => provinceDe(i) === w.region);
                if (!iles.length) return null;
                return (
                  <div key={w.region}>
                    <h4>{w.label} · {iles.length} île(s)</h4>
                    <div className="monde-fiches">
                      {iles.map((i) => (
                        <div key={i.cle} className={`monde-ligne${i.propriete === "moi" && i.role === "principale" ? " principale" : ""}`}>
                          <IslandThumb island={islandById(i.ileId)!} size={56} rotation={(i.rotation ?? 0) * 90} />
                          <div className="monde-ligne-texte">
                            <b>{i.libelle ?? nomCourt(i.ileId)}</b>
                            <span className="muted">{i.libelle ? `${nomCourt(i.ileId)} · ` : ""}{LIBELLES_PROPRIETE[i.propriete]}</span>
                            <span className="muted">{fertilitesLisibles(i)}</span>
                            {i.propriete === "moi" && (
                              <div className="monde-roles">
                                <select value={i.role === "principale" ? "principale" : "production"} aria-label="Rôle"
                                  onChange={(e) => modifierIle(i.cle, (x) => ({ ...x, role: e.target.value === "principale" ? "principale" : "auto" }))}>
                                  <option value="principale">Île principale</option>
                                  <option value="production">Île de production</option>
                                </select>
                                {i.role === "principale" && (
                                  <select value={i.palier ?? palierParDefaut(w.region)} aria-label="Palier visé"
                                    onChange={(e) => modifierIle(i.cle, (x) => ({ ...x, palier: e.target.value }))}>
                                    {paliersDeLaProvince(w.region).map((t) => <option key={t.guid} value={t.guid}>{t.name}</option>)}
                                  </select>
                                )}
                                <select value={i.dieu ?? ""} aria-label="Dieu tutélaire"
                                  onChange={(e) => modifierIle(i.cle, (x) => ({ ...x, dieu: e.target.value || undefined }))}>
                                  <option value="">Sans dieu</option>
                                  {dieux().map((d) => <option key={d.id} value={d.id}>{nomDuDieu(d)}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!c.iles.length && <p className="muted">Aucune île : ouvre « Îles et fertilités ».</p>}

              <div className="monde-barre" style={{ marginTop: 12 }}>
                <button type="button" className="primary" disabled={!!calcul || !nbPrincipales} onClick={() => void calculer(c)}>
                  {calcul ? "Calcul en cours…" : "Calculer le monde"}
                </button>
                {calcul && <span className="muted">{calcul.texte}</span>}
                {!calcul && !nbPrincipales && <span className="muted">Choisis au moins une île principale parmi tes îles.</span>}
              </div>
              {erreur && <div className="warn">Le calcul a échoué : {erreur}</div>}
              {perime && !calcul && <div className="warn">La configuration a changé depuis ce calcul : relance-le pour le mettre à jour.</div>}
              {c.resultat && <ResultatMondeVue c={c} r={c.resultat} occupe={!!calcul} onAcheter={acheter} onRefuser={refuser} />}
            </>
          )}
        </section>
      </div>

      {choixJoueur && (
        <Modal onClose={() => setChoixJoueur(null)}>
          <h3>Partie à plusieurs : quel joueur es-tu ?</h3>
          <p className="muted">Les îles de ce joueur seront à toi ; celles des autres, comptées comme adversaires.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {choixJoueur.joueurs.map((j) => (
              <button key={j.guid} type="button" onClick={() => {
                const x = choixJoueur;
                setChoixJoueur(null);
                void creerDepuisPartie(x.nom, x.partie, j.guid);
              }}>
                {j.libelle} · {j.iles} île(s)
              </button>
            ))}
          </div>
        </Modal>
      )}

      {assistant && (
        <AssistantMonde initiale={assistant.c} nouvelle={assistant.nouvelle} etape={assistant.etape}
          onEnregistrer={(x) => void enregistrer(x)} onFermer={() => setAssistant(null)} />
      )}
    </div>
  );
}
