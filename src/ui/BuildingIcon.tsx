import { useState } from "react";

type Props = {
  /** Chemin relatif de l'icône (ex: "icons/xxx.png"), absent si non extraite. */
  icon?: string;
  /** Couleur de rendu du bâtiment, utilisée en repli. */
  color: string;
  /** Classe appliquée à l'image. */
  className?: string;
  /** Classe appliquée à la pastille de repli. */
  fallbackClassName?: string;
};

/**
 * Icône d'un bâtiment, avec repli automatique sur une pastille de sa couleur.
 *
 * Les PNG de `public/icons/` sont extraits des fichiers du jeu et ne sont pas
 * versionnés : ils n'existent qu'après un `python tools/extract_icons.py`.
 * Sur un clone frais, l'image échoue à charger et le repli prend le relais —
 * l'application reste utilisable sans le jeu installé.
 */
export function BuildingIcon({ icon, color, className, fallbackClassName }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!icon || failedSrc === icon) {
    return <span className={fallbackClassName ?? "swatch"} style={{ background: color }} />;
  }

  return (
    <img
      className={className}
      src={`/${icon}`}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(icon)}
    />
  );
}
