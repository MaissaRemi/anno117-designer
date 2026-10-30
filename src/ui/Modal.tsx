import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  closeDisabled?: boolean; // ex: calcul en cours → ni Escape ni clic backdrop ne ferment
  className?: string; // variante de largeur : "opt" | "islands"
  children: ReactNode;
}

/**
 * Coquille de modale partagée : backdrop, stop-propagation, fermeture au clic backdrop,
 * Escape, rôle/aria-modal et focus à l'ouverture. Les panels fournissent leur propre
 * contenu (titre inclus — IslandPicker a un en-tête personnalisé).
 */
export function Modal({ onClose, closeDisabled, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // La dernière fermeture voulue, sans réabonner l'écouteur à chaque rendu.
  const fermeture = useRef({ onClose, closeDisabled });
  fermeture.current = { onClose, closeDisabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !fermeture.current.closeDisabled) fermeture.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Focus à l'OUVERTURE seulement. Il était repris à chaque rendu dès que le parent passait une
  // nouvelle fonction `onClose` : un champ de saisie perdait le focus à chaque frappe. Un champ
  // `autoFocus` de la fenêtre garde la main.
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop" onClick={closeDisabled ? undefined : onClose}>
      <div
        ref={ref}
        className={`modal${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
