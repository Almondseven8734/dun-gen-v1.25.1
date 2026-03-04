// dungeonGen.js  v18
//
// Y layout:
//   Floor 1: originY=playerY.  Rooms at playerY+1..playerY+19.  Separator at playerY+20.
//   Floor 2: originY=playerY-21.  Rooms at playerY-20..playerY-2.  Separator at playerY-1.
//
// Staircase (floor 1 -> floor 2):
//   floorY1 = sw.y = playerY+1   (top tread, floor 1 room floor)
//   floorY2 = floor2OriginY+1 = playerY-20  (bottom tread, floor 2 room floor)
//   Shaft cleared: playerY-20 through playerY+1 (22 blocks), punching separator at playerY-1.
//
// Floor 2 protection:
//   When building floor 2, protectedShaft is passed so the stone-carve step skips
//   the staircase XZ positions, preserving every stair tread and back-riser block.

import { world, system } from "@minecraft/server";
import { planFloor }     from "./graphPlanner.js";
import { buildFloorJob } from "./buildRunner.js";
import { saveFloorData } from "./persistence.js";
import { getStaircaseFootprint } from "./stairBuilder.js";

const REQUIRED_TAG="dungeonbuilder";
const MAX_REROLLS=5;
const FLOOR_SIZE=200;
const FLOOR_HEIGHT=20;
const FLOOR_STEP=FLOOR_HEIGHT+1; // 21

console.log("[DungeonGen] v18 loaded.");

system.afterEvents.scriptEventReceive.subscribe((ev)=>{
  if (ev.id!=="d:g") return;
  const player=ev.sourceEntity??world.getPlayers()[0];
  if (!player||player.typeId!=="minecraft:player") return;
  if (!player.hasTag(REQUIRED_TAG)) { player.sendMessage("§cNeed tag: "+REQUIRED_TAG); return; }
  const pos=player.location;
  const oX=Math.floor(pos.x)-Math.floor(FLOOR_SIZE/2);
  const oY=Math.floor(pos.y);
  const oZ=Math.floor(pos.z)-Math.floor(FLOOR_SIZE/2);
  console.log("[DungeonGen] oX="+oX+" oY="+oY+" oZ="+oZ);
  player.sendMessage("§aGenerating dungeon...");
  system.runJob(genJob(player.dimension,oX,oY,oZ,player));
});

function planWithRetry(oX,oY,oZ,entPositions,extra) {
  for (let i=0;i<MAX_REROLLS;i++) {
    const plan=planFloor(oX,oY,oZ,entPositions);
    if (plan) { if (extra) Object.assign(plan,extra); return plan; }
    console.log("[DungeonGen] retry "+(i+1));
  }
  return null;
}

function* buildFloor(dimension,plan,oX,oY,oZ,protectedShaft) {
  const job=buildFloorJob(dimension,plan,oX,oY,oZ,msg=>console.log("[Build] "+msg),protectedShaft);
  let result;
  while(true) { const n=job.next(); if(n.done){result=n.value;break;} yield; }
  return result;
}

function* genJob(dimension,oX,oY,oZ,notify) {
  const floor2OriginY=oY-FLOOR_STEP; // oY-21

  // ── Floor 1 ───────────────────────────────────────────────────────────────
  notify.sendMessage("§e[1/2] Planning floor 1...");
  const plan0=planWithRetry(oX,oY,oZ,[],{floor2OriginY});
  if (!plan0) { notify.sendMessage("§cFailed to plan floor 1."); return; }

  notify.sendMessage("§e[1/2] Building "+plan0.nodes.length+" rooms...");
  const r0=yield* buildFloor(dimension,plan0,oX,oY,oZ,null);

  if (!r0?.stairwells?.length) { notify.sendMessage("§cFloor 1: no stairwell."); return; }

  const sw0=r0.stairwells[0];
  saveFloorData(world,0,sw0.shaftX,sw0.shaftTopY,sw0.shaftZ);
  notify.sendMessage("§a[1/2] Done. Staircase at "+sw0.shaftX+","+sw0.shaftZ);

  // ── Floor 2 ───────────────────────────────────────────────────────────────
  // Build a protected-shaft descriptor so floor 2 stone-carve doesn't overwrite
  // the spiral staircase that was just placed during floor 1.
  const staircaseFloorY1 = oY+1;              // = sw.y = floor 1 room floor
  const staircaseFloorY2 = floor2OriginY+1;   // = floor 2 room floor
  const protectedShaft = {
    shaftX:    sw0.shaftX,
    shaftZ:    sw0.shaftZ,
    yMin:      staircaseFloorY2,   // bottom of staircase
    yMax:      staircaseFloorY1,   // top of staircase
    footprint: getStaircaseFootprint(),  // 3x3 shaft + back-riser offsets
  };

  const entPositions=[{x:sw0.shaftX,z:sw0.shaftZ}];

  notify.sendMessage("§e[2/2] Planning floor 2...");
  const plan1=planWithRetry(oX,floor2OriginY,oZ,entPositions,{});
  if (!plan1) { notify.sendMessage("§cFailed to plan floor 2."); return; }

  notify.sendMessage("§e[2/2] Building "+plan1.nodes.length+" rooms...");
  const r1=yield* buildFloor(dimension,plan1,oX,floor2OriginY,oZ,protectedShaft);

  if (r1?.stairwells?.length) {
    const sw1=r1.stairwells[0];
    saveFloorData(world,1,sw1.shaftX,sw1.shaftTopY,sw1.shaftZ);
    notify.sendMessage("§a[2/2] Done. Exit shaft at "+sw1.shaftX+","+sw1.shaftZ);
  } else {
    notify.sendMessage("§a[2/2] Done.");
  }

  notify.sendMessage("§b✓ Dungeon complete! Enter from the west wall.");
  console.log("[DungeonGen] Done.");
}
