# Dungeon Generator — BDS Behavior Pack

## Installation
1. Copy the dungeon/ folder into your BDS world behavior_packs/ directory
2. Enable the pack in world_behavior_packs.json
3. Add the dungeon:floors dynamic property to your manifest if using BDS 1.21+

## Usage
Give a player the dungeonbuilder tag:
  /tag @s add dungeonbuilder

Then trigger generation by typing in chat:
  /scriptevent d:g

The dungeon generates relative to your current position.
Floor 0 bottom starts at your Y. X/Z origin is your current X/Z.

## Structure
- scripts/rng.js           Seeded RNG (mulberry32)
- scripts/sdfShapes.js     SDF shape primitives for carving
- scripts/graphPlanner.js  Random walk graph layout engine
- scripts/buildRunner.js   Async layer-by-layer block placer
- scripts/stairBuilder.js  Staircase + drop shaft carver
- scripts/persistence.js   Floor/staircase data storage
- scripts/dungeonGen.js    Entry point + command handler

## Notes
- Generation runs asynchronously via system.runJob() - server stays responsive
- Each floor takes 30-180 seconds depending on room density
- All floors are reachable from entrance via flood-fill validation
- Max 2 rerolls per floor before fatal error
- Staircase locations saved to world dynamic properties
