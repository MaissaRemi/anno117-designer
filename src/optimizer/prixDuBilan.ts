/**
 * PRIX DU BILAN par défaut (cf. `IslandPlanRequest.prixDuBilan`) : 6 % de population par point
 * de déficit par maison. Mesuré le 29/10/2026 sur neuf îles romaines, Patriciens, routes
 * pavées : la sécurité incendie s'améliore sur sept (medium_04 −4,6 → +0,7 par maison,
 * large_07 −3,1 → −0,4), quatre passent en positif, et la population totale ne bouge pas
 * (+0,1 % ; small_06 −13 %, medium_05 +1,3 %). Les Bains, que le Forum évinçait, reviennent.
 *
 * C'est la plus petite valeur STABLE : 0,06, 0,08 et 0,10 rendent le même plan, mais 0,02 fait
 * perdre 32 % à medium_05 et 0,04 dégrade small_06 sur les deux tableaux. Le prix ne change
 * pas qu'un classement final : il réoriente les choix intermédiaires (recette, ancrage, dieu).
 */
export const PRIX_DU_BILAN = 0.06;
