import { useEffect, useRef, useState } from "react";
import { islandById, WORLDS } from "../data/islands";
import { LIBELLES_PROPRIETE, nouvelleConfiguration, provinceDe, type ConfigurationMonde } from "../monde/configuration";
import { fertilitesLisibles } from "../monde/fertilites";
import { depotMondes, lireExport, type DepotMondes } from "../monde/stockage";
import { AssistantMonde, type EtapeAssistant } from "./monde/AssistantMonde";
import { IslandThumb } from "./components/IslandThumb";

/**
 * ONGLET MONDE — la planification globale d'une partie.
 *
 * Étape 1 de la conception (`docs/superpowers/specs/2026-10-30-planification-globale-design.md`) :
 * les configurations, leur création par l'assistant, la fiche des îles. Le calcul (îles
 * principales, répartition de la production, flux, achats) viendra sur ces données.
 */

type Assistant = { c: ConfigurationMonde; nouvelle: boolean; etape: EtapeAssistant };

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
  const fichier = useRef<HTMLInputElement>(null);

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
  const importer = async (f: File) => {
    if (!depot) return;
    const lues = lireExport(await f.text());
    for (const c of lues) await depot.enregistrer(c);
    await recharger(depot);
    setMessage(lues.length ? `${lues.length} configuration(s) importée(s)` : "Ce fichier ne contient aucune configuration lisible");
  };

  const c = liste.find((x) => x.id === ouverte);

  return (
    <div className="monde-vue">
      <div className="monde-barre">
        <h3>🌍 Planification d'un monde</h3>
        <button type="button" className="primary" onClick={() => setAssistant({ c: nouvelleConfiguration(""), nouvelle: true, etape: 0 })}>
          + Nouvelle planification
        </button>
        <button type="button" onClick={() => fichier.current?.click()}>Importer…</button>
        <input ref={fichier} type="file" accept=".json,application/json" hidden
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
              {WORLDS.map((w) => {
                const iles = c.iles.filter((i) => provinceDe(i) === w.region);
                if (!iles.length) return null;
                return (
                  <div key={w.region}>
                    <h4>{w.label} · {iles.length} île(s)</h4>
                    <div className="monde-fiches">
                      {iles.map((i) => (
                        <div key={i.cle} className="monde-ligne">
                          <IslandThumb island={islandById(i.ileId)!} size={56} />
                          <div className="monde-ligne-texte">
                            <b>{i.libelle ?? nomCourt(i.ileId)}</b>
                            <span className="muted">{i.libelle ? `${nomCourt(i.ileId)} · ` : ""}{LIBELLES_PROPRIETE[i.propriete]}</span>
                            <span className="muted">{fertilitesLisibles(i)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!c.iles.length && <p className="muted">Aucune île : ouvre « Îles et fertilités ».</p>}
              <p className="muted" style={{ marginTop: 12 }}>
                Prochaine étape de l'outil : choisir les îles principales et lancer le calcul (production répartie sur tes autres îles, flux entre îles, bilan du monde).
              </p>
            </>
          )}
        </section>
      </div>

      {assistant && (
        <AssistantMonde initiale={assistant.c} nouvelle={assistant.nouvelle} etape={assistant.etape}
          onEnregistrer={(x) => void enregistrer(x)} onFermer={() => setAssistant(null)} />
      )}
    </div>
  );
}
