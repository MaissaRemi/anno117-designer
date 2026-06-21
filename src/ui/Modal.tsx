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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closeDisabled]);

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
