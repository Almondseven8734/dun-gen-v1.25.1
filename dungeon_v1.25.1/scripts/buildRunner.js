// buildRunner.js  v18
//
// Staircase Y values (floor 1 only):
//   floorY1 = sw.y  (stairwell room floor on floor 1, = floor1OriginY+1)
//   floorY2 = plan.floor2OriginY + 1  (reception room floor on floor 2)
//
//   buildSpiralStaircase clears floorY2 to floorY1 inclusive, punching through
//   the separator slab between floors.
//
// Floor 2 protection:
//   buildFloorJob accepts an optional protectedShaft descriptor.  When present,
//   no stone is written at those XZ positions within the shaft Y range, so the
//   staircase blocks placed during floor 1 are not overwritten.

import { buildShapeGrid, evalColumn } from "./sdfShapes.js";
import { buildSpiralStaircase, getStaircaseFootprint } from "./stairBuilder.js";

const FLOOR_SIZE   = 200;
const FLOOR_HEIGHT = 20;

function tryPlaceBlock(dimension,item,retryQueue) {
  const {x,y,z,block,weirdoDir}=item;
  try { dimension.setBlockType({x,y,z},block); }
  catch(e) { retryQueue.push(item); return; }
  if (weirdoDir!=null) {
    try {
      const blk=dimension.getBlock({x,y,z});
      if (blk) blk.setPermutation(blk.permutation.withState("weirdo_direction",weirdoDir));
    } catch(pe) { console.warn("[Build] stair perm "+x+","+y+","+z+": "+pe); }
  }
}

function* drainRetryQueue(dimension,retryQueue) {
  for (let pass=0;pass<25&&retryQueue.length>0;pass++) {
    const batch=retryQueue.splice(0);
    for (const item of batch) tryPlaceBlock(dimension,item,retryQueue);
    console.log("[Build] retry "+pass+" remaining="+retryQueue.length);
    yield;
  }
  if (retryQueue.length>0) console.warn("[Build] "+retryQueue.length+" blocks still failed.");
}

function planToShapes(plan) {
  const shapes=[];
  for (const n of plan.nodes)
    shapes.push({type:"room",cx:n.x,cy:n.y,cz:n.z,rx:n.rx,ry:n.ry,rz:n.rz,ns:n.noiseSeed||0});
  for (const e of plan.edges) {
    const segs=e.segments||[{ax:e.ax,ay:e.ay,az:e.az,bx:e.bx,by:e.by,bz:e.bz,radius:e.radius}];
    shapes.push({type:"tunnel",segments:segs,radius:e.radius});
  }
  return shapes;
}

/**
 * @param {*}      dimension
 * @param {*}      plan
 * @param {number} originX
 * @param {number} originY
 * @param {number} originZ
 * @param {Function} onProgress
 * @param {{ shaftX:number, shaftZ:number, yMin:number, yMax:number, footprint:{dx:number,dz:number}[] }|null} protectedShaft
 *   When provided, blocks at these XZ positions within [yMin,yMax] are not overwritten by stone.
 *   This preserves the spiral staircase when building floor 2.
 */
export function* buildFloorJob(dimension,plan,originX,originY,originZ,onProgress,protectedShaft) {
  const retryQueue=[];
  const shapes=planToShapes(plan);
  const grid=buildShapeGrid(shapes,originX,originZ,FLOOR_SIZE);
  console.log("[Build] shapes="+shapes.length+" originY="+originY);

  // Build a fast XZ Set for stair positions that must not be overwritten by stone
  const protectedXZ = new Set();
  if (protectedShaft) {
    for (const {dx,dz} of protectedShaft.footprint)
      protectedXZ.add((protectedShaft.shaftX+dx)+","+(protectedShaft.shaftZ+dz));
    console.log("[Build] Protecting "+protectedXZ.size+" XZ cols for staircase y="+protectedShaft.yMin+".."+protectedShaft.yMax);
  }

  // 1. Carve rooms and tunnels into stone
  for (let lx=0;lx<FLOOR_SIZE;lx++) {
    const worldX=originX+lx;
    for (let lz=0;lz<FLOOR_SIZE;lz++) {
      const worldZ=originZ+lz;
      const airLayers=evalColumn(worldX,worldZ,originY,FLOOR_HEIGHT,grid.getColumn(lx,lz));
      for (let ly=0;ly<FLOOR_HEIGHT;ly++) {
        const wy=originY+ly;
        // Do not overwrite staircase blocks from the floor above
        if (protectedShaft
            && wy >= protectedShaft.yMin
            && wy <= protectedShaft.yMax
            && protectedXZ.has(worldX+","+worldZ)) continue;
        tryPlaceBlock(dimension,
          {x:worldX,y:wy,z:worldZ,block:airLayers[ly]?"minecraft:air":"minecraft:stone"},
          retryQueue);
      }
    }
    if (onProgress&&lx%20===0) onProgress("col "+lx);
    yield;
  }

  // 2. Separator slab — ceiling of this floor
  const sepY=originY+FLOOR_HEIGHT;
  for (let lx=0;lx<FLOOR_SIZE;lx++) {
    for (let lz=0;lz<FLOOR_SIZE;lz++) {
      const wx=originX+lx, wz=originZ+lz;
      // The staircase punches through the separator — skip shaft positions
      if (protectedShaft && protectedXZ.has(wx+","+wz)) continue;
      tryPlaceBlock(dimension,{x:wx,y:sepY,z:wz,block:"minecraft:stone"},retryQueue);
    }
    if (lx%20===0) yield;
  }

  // 3. West wall hole + corridor (floor 1 entrance only)
  const ent=plan.entrance;
  if (ent&&ent.needsWestWallHole) {
    const holeZ=Math.round(ent.z);
    const holeY=originY+1;
    for (let dz=-1;dz<=1;dz++) {
      tryPlaceBlock(dimension,{x:originX,  y:holeY,  z:holeZ+dz,block:"minecraft:air"},retryQueue);
      tryPlaceBlock(dimension,{x:originX,  y:holeY+1,z:holeZ+dz,block:"minecraft:air"},retryQueue);
    }
    const corridorEndX=Math.round(ent.x-ent.rx)-1;
    for (let cx=originX+1;cx<=corridorEndX;cx++) {
      for (let dz=-1;dz<=1;dz++) {
        tryPlaceBlock(dimension,{x:cx,y:holeY,  z:holeZ+dz,block:"minecraft:air"},retryQueue);
        tryPlaceBlock(dimension,{x:cx,y:holeY+1,z:holeZ+dz,block:"minecraft:air"},retryQueue);
      }
    }
    yield;
  }

  // 4. Stairwell shafts
  const stairwellResults=[];
  for (const sw of (plan.stairwells||[])) {
    const shaftX=Math.round(sw.x);
    const shaftZ=Math.round(sw.z);

    if (plan.floor2OriginY!=null) {
      // Floor 1: spiral staircase down to floor 2 room floor
      const floorY1=sw.y;
      const floorY2=plan.floor2OriginY+1;
      console.log("[Build] Staircase floorY1="+floorY1+" floorY2="+floorY2+" (span="+(floorY1-floorY2)+")");
      const blocks=buildSpiralStaircase(shaftX,shaftZ,floorY1,floorY2);
      for (const b of blocks) tryPlaceBlock(dimension,b,retryQueue);

    } else {
      // Floor 2: open 3x3 shaft downward — no staircase
      for (let y=originY;y<=sw.y;y++)
        for (let dx=-1;dx<=1;dx++)
          for (let dz=-1;dz<=1;dz++)
            tryPlaceBlock(dimension,{x:shaftX+dx,y,z:shaftZ+dz,block:"minecraft:air"},retryQueue);
    }
    yield;
    stairwellResults.push({shaftX,shaftZ,shaftTopY:sepY});
  }

  // 5. Lodestone in boss rooms
  for (const n of plan.nodes) {
    if (n.type!=="boss") continue;
    tryPlaceBlock(dimension,{x:Math.round(n.x),y:n.y,z:Math.round(n.z),block:"minecraft:lodestone"},retryQueue);
  }
  yield;

  yield* drainRetryQueue(dimension,retryQueue);
  console.log("[Build] Floor done originY="+originY+" stairwells="+stairwellResults.length);
  return {stairwells:stairwellResults};
}
