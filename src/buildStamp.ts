/**
 * EMPREINTE DU BUNDLE RÉELLEMENT CHARGÉ PAR LE NAVIGATEUR.
 *
 * Sans elle, rien à l'écran ne dit quel code s'exécute. Un `index.html` mis en cache pointant
 * vers un ancien bundle a fait passer plusieurs correctifs pour sans effet : le serveur servait
 * bien le nouveau code — empreinte du fichier servi identique à un build local — mais le
 * navigateur ne le demandait jamais, et la seule façon de s'en apercevoir était de comparer des
 * en-têtes HTTP à la main.
 *
 * La source n'est ni git ni une variable injectée à la compilation, et c'est délibéré :
 *  - `.git` est exclu du contexte Docker, un tampon issu de git y vaudrait « inconnu » —
 *    précisément là où on en a besoin ;
 *  - une variable d'environnement passée au build dépend de qui lance la commande, le même
 *    piège que le port hôte qui retombait sur son défaut en silence.
 *
 * On lit donc le `src` de la balise `<script type="module">` du document : c'est le fichier que
 * le navigateur a effectivement chargé, et Vite le nomme d'après le HACHAGE DE SON CONTENU.
 * Deux bundles de même nom sont identiques octet pour octet ; un nom différent signifie du code
 * différent. Comparable en une seconde à `ls dist/assets/` après un build local.
 */
export const BUILD_ID: string = (() => {
  if (typeof document !== "undefined") {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    const m = src && /\/([^/]+?)\.js(?:\?.*)?$/.exec(src);
    if (m) return m[1];
  }
  // `vite dev` sert les modules non bundlés : pas de hachage, et c'est normal.
  return "dev";
})();
