# The port contract (X9)

This is the freeze point for the Godot port: what the `Sim` block of `falling-sand.html` holds, as data, at the moment it stops
growing. [ENGINE.md](ENGINE.md) says how the engine runs (the tick, the passes, sleeping, streaming); this file says what a port
has to carry over unchanged: the fields, the element table and its per-element tables, what each element keeps in its `life`, the
tree record, the save format, the biome presets and the scenarios. Everything here that can be read out of the code is, by
`tools/contract.js`, and checked against it, so the document can't drift from the game.

Contract <!-- contract:hash -->`74219e462016`<!-- /contract:hash -->: <!-- contract:counts -->
54 elements, 40 fields, 762 constants, 41 per-element tables, 3 element sets, 10 contact reactions, 20 conductance overrides, 6 biome presets, 22 generator knobs, 15 scenarios
<!-- /contract:counts -->

## The freeze point

**The Sim block freezes after the world generator**, the item Bradley queued to follow this plan. Everything in the approved queue
(N0 to N12, X1 to X8) is in, and the generator is the last thing still meant to change the Sim block, so freezing before it would
mean porting a moving target twice. The generator thread updates this contract with `node tools/contract.js --write` when it lands,
and its diff of `docs/port/contract.json` shows the port exactly what the generator added. From then on the contract is the port's
spec, and any change to Sim has to be made in the port as well.

What "frozen" means, concretely:

- **Element ids never change.** New elements go on the end (ids are in saves and in `life` values such as a spout's).
- **Field names, types and scopes stay.** A port may lay them out its own way (one allocation, a struct of arrays, a GPU texture)
  but must keep every value each field holds.
- **The save format stays readable.** Twelve `|` sections, in order; a port loads a browser save and the browser loads a port's.
- **Constants are behaviour.** All 700-odd tuning constants are in `contract.json` by name. A port reads its numbers from there
  (or from a copy made from it) rather than retyping them, so a retune on either side is one edit in one place.
- **Per-cell rules are not data.** How a cell moves or reacts is code in `stepTile` and the passes; ENGINE.md describes it and the
  tests check it (below). The contract pins the data those rules read and write, not the rules.

## Keeping it frozen

```
node tools/contract.js           # ok, or FAIL with what moved (fields, elements, constants, records, biomes, scenarios)
node tools/contract.js --write   # rewrite docs/port/contract.json, docs/port/scenarios.json and the generated parts of this file
```

Run the check with the other tests. A change to Sim that changes the contract (a new element, a retuned constant, a new field in
the tree record) fails it and says what moved; if that is the point of the change, run `--write` and say in the PR that the
contract moved, so the port follows. Edits to comments, names of locals, or the page's render/input code never fail it.

What the check can't see is a change to the rules themselves with every number left alone. For those, as before:
`BASE=old.html node tools/same.js` shows whether a world still comes out bit for bit the same, and `tools/validate.js` and
`tools/game.js` are the measured behaviour a port is held to (it can't match JS bit for bit: float rounding, `Math.exp`).

## Files

- `docs/port/contract.json`: the whole contract, machine-readable. Keys:
  - `fields`: name, element type (u8, u16, i16, i32, u32, f32, f64), scope and length in the page's window.
  - `elements`: the `EL` registry, one record per id (decay and phase targets by name).
  - `elementTables`: every flat per-element table of Sim, indexed by id (`KIND`, `CAPT`, `SPAN`, `STR`, `FUEL`, `PERM`, ...).
    `inf`/`-inf` stand for the infinities (JSON has none): a `HOLDT` of `-inf` holds no floor, a `HIAT` of `inf` never changes phase.
  - `elementSets`: `KEEP_LIFE`, `FLUID_LIFE` (which `life` values are saved, see the save), `ROOT_INTO`.
  - `elementMaps`: `FALLS_AS` (what a broken span falls as).
  - `conduct`: pairwise heat conductance where it isn't the default, the harmonic mean of the two `k`s × 0.24.
  - `reactions`: contact reactions (`RX`).
  - `record`: the keys of a tree record, a segment, the save and its world store.
  - `constants`: every top-level number, string and short list of Sim, by name.
  - `other`: `WORLD`, `BOX` (the scenario box), `VALUE` (reaction scores), and the two shared fuel records.
  - `biomes`: the presets (`BIOMES`; index = `Grid.biome`, saved with the world).
  - `knobs`: the world generator's knobs (`KNOBS`), each a setting of a biome with its range or choices (see World generator).
  - `scenarioDefs`: each built-in scenario as its definition (`defOf`: goals, fails, budget, sources, clock, weather).
- `docs/port/scenarios.json`: each built-in scenario's opening world as a save string. The scenarios' `build` functions are code,
  so a port loads these instead of re-coding them (`Game.stage` = clear, set the clock and weather, load the world).

## Fields

The values each field holds are described in ENGINE.md (Data). `ctl`, `jobs` and `deferred` are the browser's job system (worker
handshake, tile queue, work deferred to the main thread); a port with its own threading keeps the deferred list's meaning (negative:
a liquid asking for the pressure search; under W×H: a cell for `endStep`; from W×H: a wave column) and may drop the rest. `gf`
holds per-frame floats the worker threads read (growth, year, dryness, seeding, sun: `GF_*`).

<!-- contract:fields -->
| field | type | scope | length in the 960×960 window |
|---|---|---|---|
| `type` | u8 | cell | 921600 |
| `life` | u16 | cell | 921600 |
| `shade` | u8 | cell | 921600 |
| `done` | u8 | cell | 921600 |
| `temp` | f32 | cell | 921600 |
| `fuse` | f32 | cell | 921600 |
| `vx` | f32 | cell | 921600 |
| `vy` | f32 | cell | 921600 |
| `owner` | u16 | cell | 921600 |
| `swu` | f32 | col | 960 |
| `swq` | f32 | col | 960 |
| `swr` | i16 | col | 960 |
| `swp` | f32 | col | 960 |
| `dirty` | u8 | chunk | 57600 |
| `next` | u8 | chunk | 57600 |
| `hum` | f32 | air | 57600 |
| `cap` | f32 | air | 57600 |
| `airF` | f32 | air | 57600 |
| `airT` | f32 | air | 57600 |
| `chill` | f32 | air | 57600 |
| `u` | f32 | wind | 3600 |
| `v` | f32 | vface | 3660 |
| `pres` | f32 | wind | 3600 |
| `uc` | f32 | wind | 3600 |
| `vc` | f32 | wind | 3600 |
| `wsolid` | u8 | wind | 3600 |
| `wheat` | f32 | wind | 3600 |
| `ambRow` | f32 | row | 960 |
| `precip` | u32 | col | 960 |
| `sky` | i16 | aircol | 240 |
| `massT` | f32 | aircol | 240 |
| `massH` | f32 | aircol | 240 |
| `mfade` | f32 | row | 960 |
| `struck` | i32 | aircol | 240 |
| `charge` | f32 | aircol | 240 |
| `made` | i32 | types | 64 |
| `ctl` | i32 | ctl | 25 |
| `gf` | f64 | gf | 8 |
| `jobs` | i32 | jobs | 256 |
| `deferred` | i32 | defer | 32768 |
<!-- /contract:fields -->

## Elements

Kind codes (`KIND`): 0 static, 1 powder, 2 liquid, 3 gas. `life` is a lifetime range in ticks for elements that decay; otherwise
a new cell's life is `soil`. Flags: `SPAN` building material (a beam), `SUPPORTS` carries weight, `INERT` the cell pass only
conducts heat and checks support, `SOURCE` lights fuel, `ANIMAL`, `DEVICE`, `WILD` wild plant, `NUTR` holds nutrients, `SOAKS`
holds water, `POROUS` lets air through (fire under a roof), `ACIDABLE` acid eats it, `KEEP_LIFE`/`FLUID_LIFE` its life is saved,
`FUEL p` catches from a flame with chance p a tick.

<!-- contract:elements -->
| id | name | kind | density | k | cap | t0 | life | soil | decay | hi | lo | flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Empty | static |  | 0.05 | 1 | 20 |  |  |  |  |  |  |
| 1 | Sand | powder | 1.6 | 0.2 | 1.2 | 20 |  |  |  | 900°→Molten glass |  | SUPPORTS, SOAKS, ACIDABLE |
| 2 | Water | liquid | 1 | 0.6 | 3 | 20 |  |  |  | 100°→Steam |  | FLUID_LIFE |
| 3 | Stone | static |  | 0.15 | 2 | 20 |  |  |  | 1280°→Lava |  | SPAN, SUPPORTS, INERT, ACIDABLE |
| 4 | Wood | static |  | 0.1 | 1 | 20 |  |  |  | 300°→Ember |  | SPAN, SUPPORTS, INERT, ACIDABLE, KEEP_LIFE, FUEL 0.02 |
| 5 | Oil | liquid | 0.8 | 0.3 | 1 | 20 |  |  |  | 250°→Fire |  | ACIDABLE, FUEL 0.35 |
| 6 | Fire | gas |  | 0.7 | 1 | 700 | 40/80 |  |  |  | 200°→Smoke | SOURCE |
| 7 | Smoke | gas |  | 0.2 | 1 | 120 | 120/240 |  | Empty |  |  |  |
| 8 | Acid | liquid | 1.1 | 0.4 | 1 | 20 |  | 255 |  |  |  | FLUID_LIFE |
| 9 | Steam | gas |  | 0.3 | 28 | 170 |  |  |  |  | 85°→condense |  |
| 10 | Ember | static |  | 0.5 | 1 | 650 | 180/320 |  | burnout |  |  | SOURCE, POROUS, ACIDABLE |
| 11 | Lava | liquid | 3 | 0.3 | 25 | 1300 |  |  |  |  | 450°→Stone | SOURCE |
| 12 | Ice | static |  | 0.5 | 1.5 | -30 |  |  |  |  |  | SPAN, SUPPORTS, INERT, ACIDABLE, KEEP_LIFE |
| 13 | Gunpowder | powder | 1.4 | 0.2 | 1 | 20 |  |  |  | 200°→explode |  | SUPPORTS, ACIDABLE, FUEL 0.5 |
| 14 | Seed | powder | 0.9 | 0.1 | 1 | 20 | 8/20 |  |  | 220°→Fire |  | SUPPORTS, POROUS, ACIDABLE, KEEP_LIFE, FUEL 0.1 |
| 15 | Plant | static |  | 0.15 | 1 | 20 | 51208/51220 |  |  | 250°→Ember |  | SUPPORTS, POROUS, ACIDABLE, FUEL 0.06 |
| 16 | Salt | powder | 1.5 | 0.2 | 1 | 20 |  |  |  |  |  | SUPPORTS, ACIDABLE |
| 17 | Brine | liquid | 1.2 | 0.6 | 1 | 20 |  | 200 |  | 108°→boil | -20°→Ice | FLUID_LIFE |
| 18 | Glass | static |  | 0.1 | 1 | 20 |  |  |  | 1000°→Molten glass |  | SPAN, SUPPORTS, INERT |
| 19 | Gas | gas |  | 0.2 | 1 | 20 |  |  |  | 200°→explode |  | FUEL 0.5 |
| 20 | Cloud | gas |  | 0.15 | 6 | 10 |  |  |  | 120°→evaporate |  |  |
| 21 | Snow | powder | 0.5 | 0.1 | 1 | -6 |  |  |  |  |  | SUPPORTS |
| 22 | Rubble | powder | 2.4 | 0.12 | 2 | 20 |  |  |  | 1280°→Lava |  | SUPPORTS, ACIDABLE |
| 23 | Charcoal | static |  | 0.12 | 1 | 20 |  |  |  | 420°→Ember |  | SPAN, SUPPORTS, INERT, POROUS, ACIDABLE, FUEL 0.01 |
| 24 | Ash | powder | 0.7 | 0.1 | 1 | 20 |  |  |  |  |  | SUPPORTS, POROUS |
| 25 | Sapling | static |  | 0.1 | 1 | 20 |  |  |  | 300°→Ember |  | SUPPORTS, POROUS, ACIDABLE, FUEL 0.03 |
| 26 | Dirt | powder | 1.5 | 0.25 | 1.5 | 20 |  | 15450 |  |  |  | SUPPORTS, NUTR, SOAKS, ACIDABLE, KEEP_LIFE |
| 27 | Litter | powder | 0.6 | 0.1 | 1 | 20 |  |  |  | 230°→Fire |  | SUPPORTS, POROUS, ACIDABLE, FUEL 0.12 |
| 28 | Root | static |  | 0.1 | 1 | 20 |  |  |  | 300°→Ember |  | SUPPORTS, INERT, ACIDABLE, KEEP_LIFE, FUEL 0.01 |
| 29 | Metal | static |  | 1 | 1.2 | 20 |  |  |  |  |  | SPAN, SUPPORTS, INERT |
| 30 | Mud | liquid | 1.8 | 0.4 | 2 | 20 |  | 10480 |  |  |  | NUTR, SOAKS, ACIDABLE, KEEP_LIFE |
| 31 | Clay | powder | 1.8 | 0.2 | 1.5 | 20 |  | 120 |  | 600°→Brick |  | SUPPORTS, NUTR, SOAKS, ACIDABLE, KEEP_LIFE |
| 32 | Brick | static |  | 0.12 | 2 | 20 |  |  |  |  |  | SPAN, SUPPORTS, INERT |
| 33 | Rust | powder | 2 | 0.15 | 1 | 20 |  |  |  |  |  | SUPPORTS, ACIDABLE |
| 34 | Molten glass | liquid | 2.4 | 0.3 | 3 | 1000 |  |  |  |  | 700°→Glass |  |
| 35 | Shrub | static |  | 0.12 | 1 | 20 |  | 51200 |  | 260°→Ember |  | SUPPORTS, INERT, WILD, POROUS, ACIDABLE, FUEL 0.05 |
| 36 | Cactus | static |  | 0.2 | 2 | 20 |  | 61440 |  | 320°→Ember |  | SUPPORTS, INERT, WILD, POROUS, ACIDABLE, FUEL 0.004 |
| 37 | Reed | static |  | 0.15 | 1 | 20 |  | 51200 |  | 240°→Ember |  | SUPPORTS, INERT, WILD, POROUS, ACIDABLE, FUEL 0.06 |
| 38 | Rabbit | static |  | 0.1 | 1.5 | 20 |  | 160 |  | 70°→Ash |  | ANIMAL, POROUS, ACIDABLE, KEEP_LIFE |
| 39 | Grasshopper | static |  | 0.1 | 1 | 20 |  | 120 |  | 60°→Empty |  | ANIMAL, POROUS, ACIDABLE, KEEP_LIFE |
| 40 | Spout | static |  | 0.2 | 1 | 20 |  | 2 |  |  |  | SUPPORTS, DEVICE, KEEP_LIFE |
| 41 | Drain | static |  | 0.2 | 1 | 20 |  |  |  |  |  | SUPPORTS, DEVICE |
| 42 | Heater | static |  | 1 | 1 | 400 |  |  |  |  |  | SUPPORTS, DEVICE |
| 43 | Cooler | static |  | 1 | 1 | -40 |  |  |  |  |  | SUPPORTS, DEVICE |
| 44 | Fan | static |  | 0.2 | 1 | 20 |  |  |  |  |  | SUPPORTS, DEVICE, KEEP_LIFE |
| 45 | Fox | static |  | 0.1 | 1.5 | 20 |  | 180 |  | 70°→Ash |  | ANIMAL, POROUS, ACIDABLE, KEEP_LIFE |
| 46 | Bird | static |  | 0.1 | 1 | 20 |  | 160 |  | 60°→Ash |  | ANIMAL, POROUS, ACIDABLE, KEEP_LIFE |
| 47 | Hail | powder | 0.9 | 0.1 | 1 | -8 |  |  |  |  |  | SUPPORTS |
| 48 | Peat | powder | 1.2 | 0.08 | 2 | 20 |  | 230 |  |  |  | SUPPORTS, SOAKS, ACIDABLE, KEEP_LIFE |
| 49 | Coal | static |  | 0.12 | 3 | 20 |  |  |  | 800°→Ember |  | SUPPORTS, INERT, ACIDABLE, FUEL 0.004 |
| 50 | Fish | static |  | 0.1 | 1 | 20 |  | 160 |  | 38°→Litter |  | ANIMAL, ACIDABLE, KEEP_LIFE |
| 51 | Moss | static |  | 0.1 | 1 | 20 |  |  |  | 200°→Fire |  | SUPPORTS, INERT, POROUS, ACIDABLE, KEEP_LIFE, FUEL 0.04 |
| 52 | Fumes | gas |  | 0.15 | 1 | 160 | 1800/3600 |  | Empty |  |  |  |
| 53 | Dust | gas |  | 0.1 | 1 | 20 | 2400/4800 |  | Empty |  |  |  |
<!-- /contract:elements -->

### What `life` holds

`life` is a u16 per cell; its meaning is the element's. Ones not listed keep their default (`soil`) and don't use it.

| element | `life` |
|---|---|
| Fire, Smoke, Ember, Fumes, Dust | ticks left (from the element's `life` range); then `decay` (Ember: `burnout`, charcoal, ash or smoke) |
| Sand | moisture, 0-255 (100 is a cell of water) |
| Dirt, Mud | nutrients << 8 \| moisture |
| Clay | moisture |
| Peat | fire << 8 \| moisture (fire 0 is not burning; `PEAT_FIRE` when lit, burns down) |
| Water | silt in the low byte (255 while carrying a grain); bit 8: the grain is dirt, not sand |
| Brine | salt (`SALT_UNIT` a dissolved salt cell; the sea's is `SEA_SALT`) |
| Acid | strength, 0-255 (used up eating; under `SPENT` it is water; acid rain is `ACID_RAIN`) |
| Plant | sap << 8 \| growth budget (grass); a tree's leaves keep 1 |
| Shrub, Cactus, Reed | sap << 8 \| the height the plant grows to |
| Seed | ticks before it can sprout, low byte; `CONE` (bit 8): a conifer's |
| Stone | bit 0 settled; bits 1-6 water in its cracks; bit 7 frozen; bits 8-14 how cracked (127: breaks to rubble); bit 15 `LAID` (the brush's: a building material) |
| Brick, Glass, Metal, Charcoal | bit 0 settled (a held span, re-opened now and then by `audit`) |
| Ice | bit 0 settled; bit 1 `FLOAT` (has floated: comes down whole) |
| Snow | bit 0 `PACK` (wind-packed) |
| Wood | in a tree: unused (the tree draws it); painted: bit 0 settled; a dead tree's (2 or more): ticks of rot left |
| Root | a dead tree's: ticks of rot left |
| Cloud | bit 0 a storm's cloud; bit 1 `SOUR` (its rain is acid) |
| Rabbit | energy (low byte) \| age << 8 (5 bits, to `AGE_MAX`) \| gut seed << 13 (0 none, 1 grass, 2 shrub) |
| Grasshopper, Fish | energy \| age << 8; bit 15 `EGG`: an egg |
| Fox | energy \| age << 8 |
| Bird | energy \| age << 8 \| bit 13 a swallowed tree seed; or `EGG` \| warmth, an egg in a nest |
| Moss | how far it has weathered the rock (to `MOSS_SOIL`) |
| Spout | the id of the element it pours |
| Fan | which way it blows, 0-3 (`FAN_DX`, `FAN_DY`) |

### The other cell fields

- `temp` °C. Saves don't carry it: a loaded cell takes its element's `t0` (air the ambient for its row).
- `fuse`: heat banked toward a phase change (latent heat of melting or freezing, `FUSE`).
- `vx`, `vy`: momentum of liquids and flying grains (cells a tick). Animals: the sign of `vx` is the heading (2 or more running);
  a bird's `vy` is its aim (-1 climbing, 0 level, 1 down). Sliding soil or snow in a landslide or avalanche: `vy` ≥ `SLIP_TAG`.
- `owner`: the id of the tree the cell belongs to, 0 for none.
- `shade`: 0-63, a cell's fixed colour variation (render only, but saved with streamed regions so land looks the same).
- `done`: moved this tick (cleared each tick).

## Contact reactions

What two elements do when they touch, beyond heat. The rest of the chemistry is in code with its own tables: fire lighting fuel
(`FUEL`), acid eating (`ACIDABLE`), salt dissolving (`SALT_UNIT`), erosion (`ERODE`).

<!-- contract:reactions -->
| A | touching B | chance a tick | A becomes | B becomes |
|---|---|---|---|---|
| Fire | Water | 1 | Steam | (stays) |
| Fire | Brine | 1 | Steam | (stays) |
| Ember | Water | 0.5 | Charcoal | Steam |
| Ember | Water | 1 | Charcoal | (stays) |
| Ember | Brine | 0.5 | Charcoal | Steam |
| Ember | Brine | 1 | Charcoal | (stays) |
| Seed | Brine | 0.05 | Plant | Empty |
| Molten glass | Water | 0.5 | Glass | Steam |
| Molten glass | Brine | 0.5 | Glass | Steam |
| Lava | Water | 0.5 | Stone | Steam |
<!-- /contract:reactions -->

## Records

<!-- contract:records -->
- Tree record keys: `age`, `con`, `cones`, `falling`, `fert`, `id`, `leaf`, `seeds`, `segs`, `soil`, `span`, `sprout`, `stump`, `sun`, `thirst`, `waits`, `water`, `x`, `y`
- Segment keys: `age`, `alive`, `ang`, `at`, `cellCount`, `depth`, `kids`, `len`, `max`, `p`, `root`, `thick`
- Save: 12 sections split by `|`; the store JSON (section 7) has `ox`, `regions`, `seed`, `treeId`, `worldW`, and each region `hum`, `life`, `owner`, `temp`, `trees`, `type`
<!-- /contract:records -->

A **tree** is an entity, not cells: `x`, `y` its foot; `age` in tree steps (`TREE_TICK` ticks); `water` and `thirst` (steps
without water); `leaf` how much of its foliage it carries (0-1, by season); `span` the steps it lives; `fert`, `sun`, `soil` its
vigour inputs (ENGINE.md, `VIG_*`); `con` a conifer; `cones`, `seeds`, `waits` a burnt conifer's opening cones; `falling` uprooted.
`segs` is its skeleton, in growth order: each segment hangs from parent `p` (-1 for the trunk and taproot) at fraction `at` of
it, at angle `ang`, `len` long growing to `max`, `thick`, `depth` from the trunk, `kids` branches, `age`, `alive`, `root` (a root
segment). `cellCount` is scratch, rebuilt when the tree is drawn. The tree's cells are drawn from its segments (`rasterTree`):
`owner` = its id, and the tree keeps a map cell → code (code bit 0: leaf, else the segment index << 1).

The **save** (`Grid.save`, `Grid.load`): every RLE is (value, count) u16 pairs, packed little-endian and base64'd.

| # | section |
|---|---|
| 1 | RLE of `type`, preceded by the window's W and H |
| 2 | JSON list of tree records |
| 3 | RLE of `life` for `KEEP_LIFE` cells, in cell order |
| 4 | the clock (ticks) |
| 5 | RLE of `life` for `FLUID_LIFE` cells |
| 6 | RLE of the vapour field `hum`, in hundredths |
| 7 | JSON of the world: `ox`, `worldW`, `seed`, `biome`, `blank`, `treeId`, and `regions` streamed out of the window, by region index (each: base64 RLE of type, life, whole-degree temp, owner; vapour as f32; its trees) |
| 8 | RLE of sand's `life` (moisture) |
| 9 | RLE of plant `life` (Plant, Shrub, Cactus, Reed) |
| 10 | `massX` (how far the air masses have drifted), empty for no fronts |
| 11 | RLE of stone's `life` >> 1 (weathering; the settled bit is dropped and re-checked) |
| 12 | rows of land under the sky (`H - top`) |

Older saves (fewer sections, a narrower, wider or shorter window) load as ENGINE.md (Streaming) says.

## World generator

A custom world (the page's World generator) is a biome made from knobs: `customBiome(spec, from)` copies preset `from` (an index, 0
Temperate) and sets each knob in `spec` over it, kept in its range (`lo`..`hi`, rounded where `int`; on/off as 1/0 where `check`;
one of `opts`). `Grid.biome` is then that object instead of an index; `biomeOf(k)` takes either. It saves as it is (section 7's
`biome` is an object), and `load` passes it back through `customBiome`, so a hand-edited save can't set a knob out of range. A
port keeps `Grid.biome` as either a preset index or a full biome record. Knobs whose setting a preset leaves unset (`wide`) fall
back to `WORLD.WIDE`. With every knob at a preset's own value the world is that preset's, cell for cell (validate `generator`).
`flip` only tells a slider to run the other way: less `base` or `sandy` is higher land or more sand.

<!-- contract:knobs -->
| knob | setting | range or choices | Temperate | Alpine | Wetland | Volcanic island | Scrubland | Coast |
|---|---|---|---|---|---|---|---|---|
| World width | `wide` | 3840 / 6400 / 9600 / 12800 | (6400) | (6400) | (6400) | (6400) | (6400) | (6400) |
| Land height | `base` | 0.12..0.5 (less is more) | 0.32 | 0.17 | 0.44 | 0.36 | 0.32 | 0.32 |
| Ruggedness | `amp` | 0..0.9 | 0.35 | 0.75 | 0.08 | 0.22 | 0.35 | 0.35 |
| Hill width | `wave` | 30..250 whole | 90 | 150 | 40 | 90 | 90 | 90 |
| Warmth | `warm` | -12..12 whole | 0 | 0 | 0 | 0 | 0 | 0 |
| Dryness | `arid0` | 0..0.8 | 0 | 0 | 0 | 0 | 0.32 | 0 |
| Dry spells | `aridK` | 0..1.5 | 1 | 0.4 | 0 | 0.2 | 0.6 | 0.5 |
| Desert east of home | `desert` | on/off | 1 | 0 | 0 | 0 | 1 | 0 |
| Water table | `wet` | 0..1 | 0 | 0 | 0.8 | 0 | 0 | 0 |
| Sandy lowlands | `sandy` | 0.3..0.8 (less is more) | 0.42 | 0.5 | 0.62 | 0.42 | 0.42 | 0.42 |
| Lakes | `lakes` | 0..1 | 0.5 | 0.4 | 1 | 0.5 | 0 | 0.5 |
| Lake depth | `lakeDeep` | 2..16 whole | 6 | 6 | 10 | 6 | 6 | 6 |
| Rivers | `rivers` | 0..1 | 0.6 | 0.4 | 0.6 | 0.6 | 0.3 | 0.6 |
| River at home | `river0` | on/off | 1 | 0 | 0 | 1 | 1 | 1 |
| Coast | `coast` | null / beach / marsh / cliff / none | null | null | marsh | cliff | null | null |
| Volcano on the coast | `volcano` | on/off | 0 | 0 | 0 | 1 | 0 | 0 |
| Start at | `home` | middle / coast | middle | middle | middle | coast | middle | coast |
| Snow cover | `snow` | 0..16 whole | 0 | 10 | 0 | 0 | 0 | 0 |
| Forest | `trees` | 0..2.5 | 1 | 1 | 1 | 1 | 1 | 1 |
| Grass | `grass` | 0..1.33 | 1 | 1 | 1 | 1 | 1 | 1 |
| Caves | `caves` | 0..2 | 1 | 1 | 1 | 1 | 1 | 1 |
| Wildlife | `animals` | 0..3 | 1 | 1 | 1 | 1 | 1 | 1 |
<!-- /contract:knobs -->

What the knobs that are new with the generator do (the others are X6's, in ENGINE.md and the `BIOMES` comment):
- `warm`: degrees added to the climate all year (`Grid.warmK`, in `updateClimate`): the air (`ambAt`), a site's yearly mean
  (`warmth`, so the treeline), and the season's growth and foliage curves.
- `trees`, `grass`: multiply the odds of a tree in each `TREES_EVERY` run and of grass on a column at generation.
- `caves`: a cavern opens where the cave noise passes `CAVE_AT + (1 - caves) × CAVE_K`; 0 is no caverns at all.
- `animals`: multiplies every animal's odds at generation (rabbits, grasshoppers, foxes, birds, fish).
- `coast: 'none'`: no sea (`seaOf` returns null), so no volcano either.
- `wide`: the world's width; the desert east of home sits at `wide / 2 + ARID_NEAR`.

## Randomness, and making the same world

All randomness is `R()`, mulberry32 seeded per tile per frame from `mix(frameSeed, tile)`; terrain, rivers, the sea, air masses
and every other world feature hash world coordinates with `mix`/`hash01` and the world seed. Both are 32-bit integer functions, so
a port that copies them exactly (with `Math.imul` as wrapping 32-bit multiply, `>>>` as unsigned shift) makes the same world from
the same seed and biome, cell for cell, even though its ticks after that drift from the browser's. That is worth keeping: a seed
link then opens the same land in both.

## Not in the contract

The render and input block (drawing, the rack, the editor form, sound, the minimap, time-lapse, undo) is browser code and is
replaced wholesale. So are the worker pool and `canShare`. The census and inspector (`Grid.census`, `Grid.inspect`) are in Sim and
read only the data above.
