# Anno 117 Designer

[![CI](https://github.com/MaissaRemi/anno117-designer/actions/workflows/ci.yml/badge.svg)](https://github.com/MaissaRemi/anno117-designer/actions/workflows/ci.yml)

A web tool to plan and optimise building layouts for **Anno 117: Pax Romana** — running on the game's real data, extracted straight from its own archives.

> ⚠️ **Work in progress — not validated yet.**
> The tool runs end to end, but its output has not been verified against the game: layouts it
> produces have not been rebuilt in-game to confirm they are legal and behave as predicted, and
> building footprints are read from `.ifo` bounding boxes with a ±1 tile margin of error.
> Treat it as a planning aid and a technical exercise, not as a reference for optimal builds.

---

## Why this exists

In Anno, every building comes with strings attached. It needs road access. It projects an influence radius that has to cover the right neighbours. Farms need a connected field of an exact size. And the island you are building on has an irregular coastline that refuses to cooperate.

Planning a district that satisfies all of that at once is a genuinely interesting packing problem. Solving it *inside* the game is not: you place, you check, you tear down, you place again.

So I moved the problem outside the game — and set myself one rule that shaped everything after it: **no hand-typed numbers**. Not values copied off a wiki, not approximations. The actual figures Ubisoft ships in the game files. Which meant that before writing a single line of the editor, I had to be able to read Anno's archives.

That constraint turned a layout tool into three problems worth solving.

## Three problems worth solving

**Reading an undocumented binary format.** Anno stores its data in `.rda` archives — *Resource File V2.2*. A 792-byte header, a file directory that lives *before* the block header pointing at it, zlib-compressed payloads, UTF-16LE paths in 560-byte records. There is no official spec. [`tools/rda_extract.py`](tools/rda_extract.py) is a from-scratch implementation, and it is the foundation everything else stands on.

**Modelling an economy that feeds itself.** Population consumes goods; producing those goods costs workforce; workforce comes from population. It is a circular dependency, so it cannot be computed in one pass. The population planner resolves it as a **fixed-point iteration** — population → needs → production → workforce → more population → … — with a convergence guarantee that hinges on one detail: `NeedConsumptionRate` is defined *per house*, not per inhabitant. Get that wrong and the cascade diverges. There is a fallback and a warning if it ever does.

**Packing shapes under constraints.** Placement is 2D bin packing with side conditions — roads have to exist and connect, radii have to overlap the right things, fields need contiguous free space. The optimiser combines a **greedy macro-tile decoder** with **simulated annealing** over placement order and road-band offsets, running in a **Web Worker** so the interface never freezes.

## What it does

- **Real building catalogue** — 338 buildings with their true dimensions, rotation, road requirement, radius, field size, production chain and region. Searchable, filterable, and editable in-app.
- **Real islands** — load any of the **55 islands** in the game at its exact size and coastline shape.
- **Free-form grid** — or paint your own buildable area.
- **Placement with live validation** — valid/invalid preview, rotation, moving, locking. Broken rules are outlined in red and explained in the side panel.
- **Roads and fields** painted by hand, checked against the real rules: road adjacency, field size, connectivity and contact with its building.
- **Influence radii** drawn as overlays.
- **Population planner** — set a target population per tier and get the full building plan back.
- **Automatic optimiser** — hand it a shopping list and weighted goals, get a layout.
- **Persistence** — browser autosave, JSON import/export, PNG export.

---

## Installation

The extracted game data is committed, so the catalogue, the islands and the economy all work out of the box — no game installation needed just to try the tool.

Building icons are the one exception, see [below](#icons-are-not-bundled). Without them the interface falls back to a coloured tile per building; everything else behaves normally.

### With Docker

Nothing to install but Docker itself.

```bash
git clone https://github.com/MaissaRemi/anno117-designer.git
cd anno117-designer
docker compose up
```

Open **http://localhost:8080**.

The image is a multi-stage build: `node:20-alpine` compiles and type-checks, then only the static bundle is copied into `nginx:alpine`. The final image carries no toolchain and no source.

For hot reload while developing:

```bash
docker compose --profile dev up dev     # http://localhost:5173
```

### With Node

```bash
git clone https://github.com/MaissaRemi/anno117-designer.git
cd anno117-designer
npm install
npm run dev          # http://localhost:5173
```

Requires **Node.js 18+**.

### Other commands

```bash
npm run build        # type-check then production build into dist/
npm test             # unit tests for the rule engine and the optimiser
npm run lint
npm run typecheck
```

The same four steps run on every push and pull request through GitHub Actions — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Regenerate the game data (optional)

```bash
pip install -r tools/requirements.txt
export ANNO_GAME_DIR="<...>/Anno 117 - Pax Romana/maindata"   # Windows: set ANNO_GAME_DIR=...
python tools/extract_icons.py
```

---

## The game data pipeline

Nothing in this tool is hard-coded. All 338 buildings, 55 islands, production chains and terrain heights are produced by an extraction pipeline that reads the game's archives directly. When the game gets patched, you re-run the pipeline.

### Icons are not bundled

The 222 building icons are Ubisoft artwork. They are **not committed** — `public/icons/` is gitignored — and they are not redistributed here. Run `python tools/extract_icons.py` against your own installation to generate them.

### Full regeneration

```bash
export ANNO_GAME_DIR="<...>/Anno 117 - Pax Romana/maindata"

python tools/rda_extract.py get "$ANNO_GAME_DIR/config.rda" data/base/config/export/assets.xml   .gamedata/assets_base.xml
python tools/rda_extract.py get "$ANNO_GAME_DIR/config.rda" data/base/config/gui/texts_french.xml .gamedata/texts_french.xml

python tools/build_catalog.py     # -> src/data/catalog.generated.json
python tools/build_economy.py     # -> src/data/economy.generated.json
python tools/build_islands.py     # -> src/data/islands.generated.json
python tools/build_terrain.py     # -> src/data/terrain*.generated.json
python tools/extract_icons.py     # -> public/icons/*.png   (not committed)
```

| Script | Role |
|---|---|
| `rda_extract.py` | RDA "Resource File V2.2" archive extractor |
| `build_catalog.py` | `assets.xml` + localised text + sizes (`.ifo` BoundingBox) → catalogue |
| `build_economy.py` | Needs, production chains, workforce |
| `build_islands.py` | Sizes and land/sea masks for the 55 islands |
| `build_terrain.py` | Relief and heightmaps |
| `extract_icons.py` | Building icons, 4K DDS → 64px PNG |

**Exact**: roads, radii, fields, production, names. **±1 tile**: building sizes, read from `.ifo` bounding boxes — correctable in the in-app catalogue editor.

---

## Population planner

Press **👥 Population**, set a target population per tier, and the model works out the plan.

- **Needs** — each residence carries a `NeedsList`: goods consumed at a given rate, plus services.
- **Workforce cascade** — workforce is treated as a per-tier good (`ConnectedWorkforce`, `PopulationToWorkforceFactor`) consumed by buildings, resolved by the fixed-point solver described above.
- **Output** — population and residences per tier, production buildings with their full chains, and service buildings. **Place on island** hands the result to the optimiser.
- Data: `tools/build_economy.py` → `src/data/economy.generated.json`. Solver: `src/economy/`.

## Real island shapes

Press **🏝 Island** to load one of the game's 55 islands as your grid.

- Grid size read from each island's `.a7minfo` (width and height at offset 8).
- Shape derived from the land/sea mask of the rendered `mapimage.png`, resampled to the real grid size and stored RLE-encoded.
- Thumbnails in the picker; loading an island replaces the current grid.

## Automatic optimiser

Press **⚙ Optimise**, list the buildings you want with quantities, weight the goals (building count / radius coverage / compactness / minimal roads), set a time budget, run.

- **Road generation** — horizontal bands plus a vertical spine, so road access holds by construction.
- **Fields** — farms get their free area as a connected block under the building, with the exact tile count.
- **Locked buildings** are preserved and the algorithm fills around them. Hand-drawn roads are kept; generated ones are replaced on each run (`gen` flag).
- **Algorithm** — greedy macro-tile packing decoder, then simulated annealing over order and band offset, in a Web Worker, scored through `engine/`.

Code: `src/optimizer/` (`types`, `greedy`, `anneal`, `score`, `worker`, `runOptimizer`). Tests: `src/optimizer/optimizer.test.ts`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `R` | Rotate the pending placement, or the selected building |
| `Del` | Delete the selected building |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Esc` | Deselect |
| Wheel | Zoom · right-click drag to pan |

## Architecture

```
src/
  model/      types, factories, (de)serialisation
  engine/     pure rules + tests (placement, roads, fields, radii, validation)
  economy/    fixed-point workforce and needs solver
  optimizer/  greedy decoder, simulated annealing, Web Worker
  state/      Zustand store (layout, selection, mode, undo/redo)
  render/     Canvas 2D drawing layer
  ui/         React components
  data/       generated game data + seed
  persist/    localStorage, JSON import/export, PNG export
tools/        Python extraction pipeline
```

The rule engine is deliberately kept as **pure functions with no React dependency**. That is what makes it testable — **167 tests across 31 files** cover geometry, placement rules, road and field validation, the economy solver and the optimiser — and what lets the optimiser reuse the exact same scoring code as the live editor, rather than a reimplementation that drifts.

---

## Where it stands

What works: the extraction pipeline, the rule engine and its 167 tests, the editor, the population
planner, the optimiser, and the Docker build.

What is missing before this can be called finished:

- **In-game validation** — no layout produced by the optimiser has been rebuilt in Anno 117 to
  confirm the placement rules and radii match the game's actual behaviour.
- **Exact footprints** — sizes come from `.ifo` bounding boxes and are accurate to ±1 tile. They are
  editable in-app, but they are not yet correct by default for every building.
- **Coverage across regions** — most testing was done on Latium content.

The rule engine is tested against itself, not against the game. That distinction matters, and it is
the main reason this is still marked as in progress.

## Legal notice

Unofficial personal project, **not affiliated with Ubisoft** in any way. *Anno* is a registered trademark of Ubisoft Entertainment.

The game data used by this tool is extracted from a local installation and remains the property of Ubisoft. Building icons are not redistributed: generate them from your own files with `tools/extract_icons.py`. A legal copy of Anno 117 is required to run the extraction pipeline.
