// stairBuilder.js  v24
//
// Spiral staircase from floorY1 (top) DOWN to floorY2 (bottom).
//
// weirdo_direction (Bedrock Edition):
//   0 = faces east, 1 = faces west, 2 = faces south, 3 = faces north
//   "faces" = direction the low/open end points = direction player faced when placing
//
// Treads on cardinal cells, facing inward (low end toward post).
// Support block at the TRAILING corner (anti-travel direction) from the tread —
// i.e. the corner BEHIND you as you walk up the CW spiral.
//
// CW spiral: east -> south -> west -> north
//
//  Tread        wd  low-end   Travel   Trailing corner  Support
//  east [+1, 0]  1  west      south    NE [+1,-1]       [+1,-1]
//  south[ 0,+1]  3  north     west     SE [+1,+1]       [+1,+1]
//  west [-1, 0]  0  east      north    SW [-1,+1]       [-1,+1]
//  north[ 0,-1]  2  south     east     NW [-1,-1]       [-1,-1]

const SPIRAL = [
  [ 1,  0, 3,  1, -1],  // east  tread, faces north, support NE [+1,-1]
  [ 0,  1, 0,  1,  1],  // south tread, faces east,  support SE [+1,+1]
  [-1,  0, 2, -1,  1],  // west  tread, faces south, support SW [-1,+1]
  [ 0, -1, 1, -1, -1],  // north tread, faces west,  support NW [-1,-1]
];

export function buildSpiralStaircase(shaftX, shaftZ, floorY1, floorY2) {
  const blocks = [];

  if (floorY2 >= floorY1) {
    console.warn("[Stair] floorY2 >= floorY1 — nothing to build");
    return blocks;
  }

  // 1. Clear 3x3 shaft
  for (let y = floorY2; y <= floorY1; y++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        blocks.push({ x: shaftX + dx, y, z: shaftZ + dz, block: "minecraft:air" });

  // 2. Centre post
  for (let y = floorY2; y <= floorY1; y++)
    blocks.push({ x: shaftX, y, z: shaftZ, block: "minecraft:stone_bricks" });

  // 3. Treads + support blocks
  let si = 0;
  for (let y = floorY1; y >= floorY2; y--) {
    const [dx, dz, weirdoDir, sx, sz] = SPIRAL[si % 4];
    si++;
    blocks.push({ x: shaftX + dx, y, z: shaftZ + dz, block: "minecraft:stone_brick_stairs", weirdoDir });
    blocks.push({ x: shaftX + sx, y, z: shaftZ + sz, block: "minecraft:stone_bricks" });
  }

  return blocks;
}

export function getStaircaseFootprint() {
  const cells = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      cells.push({ dx, dz });
  return cells;
}
