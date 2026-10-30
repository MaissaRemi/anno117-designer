import { useMemo, useState } from "react";
import { islandById, islands, regionOfIsland, WORLDS, worldLabel, type Island } from "../../data/islands";
import { LIBELLES_PROPRIETE, nouvelleIle, provinceDe, type ConfigurationMonde, type IleDuMonde, type Propriete } from "../../monde/configuration";
import { fertilitesDeLaProvince, fertilitesLisibles } from "../../monde/fertilites";
import { Modal } from "../Modal";
import { IslandThumb } from "../components/IslandThumb";

/**
 * ASSISTANT D'UNE CONFIGURATION DE MONDE — une grande fenêtre au premier plan, en trois étapes :
 * le nom, les îles de la carte (reconnues à leur forme) et leurs fertilités, puis à qui elles
 * sont. Chaque passage à l'étape suivante enregistre : fermer en cours de route ne perd rien.
 * Conception : `docs/superpowers/specs/2026-10-30-planification-globale-design.md`.
 */

export type EtapeAssistant = 0 | 1 | 2;
const ETAPES = ["Nom", "Îles et fertilités", "Propriété"] as const;

const TAILLES = [
  { id: "small", label: "Petites" }, { id: "medium", label: "Moyennes" }, { id: "large", label: "Grandes" },
  { id: "extralarge", label: "Très grandes" }, { id: "continental", label: "Continentales" },
] as const;
const tailleDe = (id: string) => TAILLES.find((t) => id.includes(`_${t.id}`))?.id ?? "autre";

interface Props {
  initiale: ConfigurationMonde;
  /** Configuration jamais enregistrée : la fermer à l'étape du nom ne garde rien. */
  nouvelle: boolean;
  etape?: EtapeAssistant;
  onEnregistrer: (c: ConfigurationMonde) => void;
  onFermer: () => void;
}

export function AssistantMonde({ initiale, nouvelle, etape: etapeInitiale = 0, onEnregistrer, onFermer }: Props) {
  const [c, setC] = useState(initiale);
  const [etape, setEtape] = useState<EtapeAssistant>(etapeInitiale);
  const [enregistree, setEnregistree] = useState(!nouvelle);
  const maj = (f: (c: ConfigurationMonde) => ConfigurationMonde) =>
    setC((prev) => ({ ...f(prev), modifieLe: new Date().toISOString() }));
  const majIle = (cle: string, f: (i: IleDuMonde) => IleDuMonde) =>
    maj((prev) => ({ ...prev, iles: prev.iles.map((i) => (i.cle === cle ? f(i) : i)) }));

  const enregistrer = () => { onEnregistrer(c); setEnregistree(true); };
  const aller = (e: EtapeAssistant) => { enregistrer(); setEtape(e); };
  const fermer = () => {
    if (enregistree || c.nom.trim()) enregistrer();
    onFermer();
  };
  const nomValide = c.nom.trim().length > 0;

  return (
    <Modal className="monde" onClose={fermer}>
      <div className="monde-tete">
        <h3>{nouvelle && !enregistree ? "Nouvelle planification" : c.nom}</h3>
        <ol className="monde-etapes">
          {ETAPES.map((t, k) => (
            <li key={t} className={k === etape ? "active" : k < etape ? "faite" : ""}>
              <button type="button" disabled={!nomValide} onClick={() => aller(k as EtapeAssistant)}>{k + 1}. {t}</button>
            </li>
          ))}
        </ol>
      </div>

      <div className="monde-corps">
        {etape === 0 && (
          <div className="monde-nom">
            <label>
              Nom de la configuration
              <input autoFocus value={c.nom} placeholder="Ma partie avec Ethan"
                onChange={(e) => maj((p) => ({ ...p, nom: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter" && nomValide) aller(1); }} />
            </label>
            <p className="muted">Une configuration décrit une partie : les îles des deux provinces, leurs fertilités et à qui elles sont.</p>
          </div>
        )}
        {etape === 1 && <EtapeIles c={c} maj={maj} majIle={majIle} />}
        {etape === 2 && <EtapePropriete c={c} majIle={majIle} />}
      </div>

      <div className="modal-actions">
        <button type="button" onClick={fermer}>Fermer</button>
        {etape > 0 && <button type="button" onClick={() => aller((etape - 1) as EtapeAssistant)}>← Précédent</button>}
        {etape < 2
          ? <button type="button" className="primary" disabled={!nomValide || (etape === 1 && !c.iles.length)} onClick={() => aller((etape + 1) as EtapeAssistant)}>Suivant →</button>
          : <button type="button" className="primary" onClick={fermer}>Terminer</button>}
      </div>
    </Modal>
  );
}

// ─── ÉTAPE 2 : LES ÎLES DE LA CARTE ET LEURS FERTILITÉS ─────────────────────────────────

function EtapeIles({ c, maj, majIle }: {
  c: ConfigurationMonde;
  maj: (f: (c: ConfigurationMonde) => ConfigurationMonde) => void;
  majIle: (cle: string, f: (i: IleDuMonde) => IleDuMonde) => void;
}) {
  const [province, setProvince] = useState<string>("Roman");
  const [taille, setTaille] = useState<string>("");
  const [recherche, setRecherche] = useState("");
  const [rotation, setRotation] = useState(0);
  const [choisie, setChoisie] = useState<string | null>(c.iles[c.iles.length - 1]?.cle ?? null);

  const catalogue = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return islands.filter((i) => regionOfIsland(i.id) === province
      && (!taille || tailleDe(i.id) === taille)
      && (!q || i.name.toLowerCase().includes(q) || i.id.includes(q)));
  }, [province, taille, recherche]);
  const nombre = (id: string) => c.iles.filter((i) => i.ileId === id).length;

  const ajouter = (isl: Island) => {
    const n = nouvelleIle(isl.id);
    maj((p) => ({ ...p, iles: [...p.iles, n] }));
    setChoisie(n.cle);
  };
  const retirer = (cle: string) => {
    maj((p) => ({ ...p, iles: p.iles.filter((i) => i.cle !== cle) }));
    if (choisie === cle) setChoisie(null);
  };
  const ile = c.iles.find((i) => i.cle === choisie);

  return (
    <div className="monde-colonnes">
      <section className="monde-catalogue">
        <div className="monde-filtres">
          <div className="world-switch" role="group" aria-label="Province">
            {WORLDS.map((w) => (
              <button key={w.region} type="button" className={province === w.region ? "active" : ""} onClick={() => setProvince(w.region)}>{w.label}</button>
            ))}
          </div>
          <select value={taille} onChange={(e) => setTaille(e.target.value)} aria-label="Taille">
            <option value="">Toutes les tailles</option>
            {TAILLES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <input type="search" placeholder="Chercher par nom…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          <button type="button" title="Tourner les vignettes d'un quart de tour : une île peut apparaître tournée sur la carte"
            onClick={() => setRotation((r) => (r + 90) % 360)}>⟳ {rotation}°</button>
        </div>
        <p className="muted">Clique sur les îles que tu vois sur ta carte. Vert : terre constructible ; brun : relief ; bleu : rivière.</p>
        <div className="island-grid monde-grille">
          {catalogue.map((isl) => (
            <button key={isl.id} type="button" className={`island-card${nombre(isl.id) ? " choisie" : ""}`} onClick={() => ajouter(isl)} title={isl.id}>
              <IslandThumb island={isl} size={112} rotation={rotation} />
              <span className="island-name">{isl.name.replace(/ \((Roman|Celtic)\)$/, "")}</span>
              <span className="muted">{isl.size.w}×{isl.size.h}{nombre(isl.id) ? ` · ×${nombre(isl.id)}` : ""}</span>
            </button>
          ))}
          {!catalogue.length && <p className="muted">Aucune île ne correspond.</p>}
        </div>
      </section>

      <section className="monde-selection">
        <h4>Îles de la carte ({c.iles.length})</h4>
        {!c.iles.length && <p className="muted">Aucune île pour l'instant.</p>}
        {WORLDS.map((w) => {
          const liste = c.iles.filter((i) => provinceDe(i) === w.region);
          if (!liste.length) return null;
          return (
            <div key={w.region}>
              <div className="muted monde-province">{w.label} · {liste.length}</div>
              {liste.map((i) => (
                <div key={i.cle} className={`monde-ligne${i.cle === choisie ? " active" : ""}`} onClick={() => setChoisie(i.cle)}>
                  <IslandThumb island={islandById(i.ileId)!} size={40} />
                  <div className="monde-ligne-texte">
                    <b>{nomCourt(i.ileId)}</b>
                    <span className="muted">{resumeFertilites(i)}</span>
                  </div>
                  <button type="button" className="btn-ghost" title="Retirer" onClick={(e) => { e.stopPropagation(); retirer(i.cle); }}>✕</button>
                </div>
              ))}
            </div>
          );
        })}
        {ile && <FicheIle ile={ile} majIle={majIle} />}
      </section>
    </div>
  );
}

const nomCourt = (ileId: string) => (islandById(ileId)?.name ?? ileId).replace(/ \((Roman|Celtic)\)$/, "");
const resumeFertilites = (i: IleDuMonde) =>
  i.fertilites === null ? "fertilités inconnues" : i.fertilites.length ? `${i.fertilites.length} fertilité(s)` : "aucune fertilité cochée";

function FicheIle({ ile, majIle }: { ile: IleDuMonde; majIle: (cle: string, f: (i: IleDuMonde) => IleDuMonde) => void }) {
  const groupes = useMemo(() => fertilitesDeLaProvince(provinceDe(ile)), [ile]);
  const basculer = (guid: string) => majIle(ile.cle, (i) => {
    const f = i.fertilites ?? [];
    return { ...i, fertilites: f.includes(guid) ? f.filter((x) => x !== guid) : [...f, guid] };
  });
  return (
    <div className="monde-fiche">
      <label>
        Nom dans la partie <span className="muted">(facultatif)</span>
        <input value={ile.libelle ?? ""} placeholder={nomCourt(ile.ileId)}
          onChange={(e) => majIle(ile.cle, (i) => ({ ...i, libelle: e.target.value || undefined }))} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={ile.fertilites === null}
          onChange={(e) => majIle(ile.cle, (i) => ({ ...i, fertilites: e.target.checked ? null : [] }))} />
        <span>Fertilités inconnues</span>
      </label>
      {ile.fertilites !== null && groupes.map((g) => (
        <div key={g.categorie} className="monde-fertilites">
          <span className="muted">{g.libelle}</span>
          <div>
            {g.fertilites.map((f) => (
              <button key={f.guid} type="button" className={`chip-bouton${ile.fertilites?.includes(f.guid) ? " active" : ""}`}
                onClick={() => basculer(f.guid)}>{f.nom.replace(/^Fertilité \((.*)\)$/, "$1")}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ÉTAPE 3 : À QUI SONT LES ÎLES ──────────────────────────────────────────────────────

function EtapePropriete({ c, majIle }: { c: ConfigurationMonde; majIle: (cle: string, f: (i: IleDuMonde) => IleDuMonde) => void }) {
  return (
    <div className="monde-propriete">
      <p className="muted">
        Indique les îles qui sont à toi. Les autres peuvent être achetables, à un adversaire, ou inconnues :
        le moteur pourra proposer d'acheter une île achetable ou inconnue, jamais celle d'un adversaire.
      </p>
      {WORLDS.map((w) => {
        const liste = c.iles.filter((i) => provinceDe(i) === w.region);
        if (!liste.length) return null;
        return (
          <div key={w.region}>
            <h4>{worldLabel(w.region)}</h4>
            {liste.map((i) => (
              <div key={i.cle} className="monde-ligne">
                <IslandThumb island={islandById(i.ileId)!} size={40} />
                <div className="monde-ligne-texte">
                  <b>{i.libelle ?? nomCourt(i.ileId)}</b>
                  <span className="muted">{i.libelle ? `${nomCourt(i.ileId)} · ` : ""}{fertilitesLisibles(i)}</span>
                </div>
                <div className="world-switch" role="group" aria-label="Propriété">
                  {(Object.keys(LIBELLES_PROPRIETE) as Propriete[]).map((p) => (
                    <button key={p} type="button" className={i.propriete === p ? "active" : ""}
                      onClick={() => majIle(i.cle, (x) => ({ ...x, propriete: p }))}>{LIBELLES_PROPRIETE[p]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
