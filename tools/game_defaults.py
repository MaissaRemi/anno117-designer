"""Défauts du MOTEUR de jeu (valeurs implicites quand l'asset n'override pas).
Partagés entre build_catalog.py et build_economy.py — une seule source de vérité.
"""

# FactoryBase/CycleTime absent = 30 s (confirmé [WEB] : scierie 30 s, cf.
# GAME_MECHANICS.md §5 ; concerne mines/scieries/bûcherons/charbonnières…)
CYCLE_TIME_DEFAULT = 30
