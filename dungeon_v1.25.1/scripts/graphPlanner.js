// graphPlanner.js  v17
//
// ALL rooms guaranteed reachable:
//   - Growth loop only spawns nodes with a parent connection (spanning tree)
//   - Bridge pass runs AFTER stairwell is added, so stairwell is also bridged if needed
//   - Thin tunnels eliminated: minimum radius 1.5 always (no sub-1 radius)
//   - Dead-ends still added to nodes but get a guaranteed parent edge
//
// Room sizes:
//   BOSS:      rx 14-20, arena
//   CAVERN:    rx 6-10,  minor battle
//   ENTRANCE / RECEPTION: rx 7, fixed
//   STAIRWELL: rx 4, small antechamber
//   JUNCTION:  rx 4-6
//   DEAD_END:  rx 3-5

import { RNG } from './rng.js';

export const NodeType = {
  CAVERN:    'cavern',
  BOSS:      'boss',
  JUNCTION:  'junction',
  DEAD_END:  'dead_end',
  STAIRWELL: 'stairwell',
  RECEPTION: 'reception',
  ENTRANCE:  'entrance',
};

export const EdgeType = { TUNNEL: 'tunnel' };

const FLOOR_SIZE   = 200;
const FLOOR_HEIGHT = 20;
const MARGIN       = 14;
const MIN_TUNNEL_R = 1.5;   // absolute minimum tunnel radius — always passable

function clamp(v,lo,hi) { return v<lo?lo:v>hi?hi:v; }
function dist2(a,b) {
  const dx=a.x-b.x,dz=a.z-b.z; return Math.sqrt(dx*dx+dz*dz);
}
function roomsOverlap(a,b) {
  const pad=5;
  return Math.abs(a.x-b.x)<(a.rx+b.rx+pad) && Math.abs(a.z-b.z)<(a.rz+b.rz+pad);
}

// Point exactly on room surface in direction (dx,dz)
function roomSurfacePoint(room,dx,dz) {
  const len=Math.sqrt(dx*dx+dz*dz);
  if (len===0) return {x:room.x,y:room.y,z:room.z};
  const nx=dx/len, nz=dz/len;
  const denom=Math.sqrt((nz/room.rx)**2+(nx/room.rz)**2);
  const t=1.0/denom;
  return {x:room.x+nx*t, y:room.y, z:room.z+nz*t};
}

function pushOutsideRooms(px,pz,rooms,margin) {
  for (let iter=0;iter<8;iter++) {
    for (const r of rooms) {
      const ex=(px-r.x)/(r.rx+margin), ez=(pz-r.z)/(r.rz+margin);
      const d=Math.sqrt(ex*ex+ez*ez);
      if (d<1.0&&d>1e-6) { const s=1/d; px=r.x+(px-r.x)*s; pz=r.z+(pz-r.z)*s; }
    }
  }
  return {x:px,z:pz};
}

function buildTunnelSegments(rng,ax,ay,az,bx,by,bz,radius,allNodes) {
  const ddx=bx-ax,ddz=bz-az;
  const hd=Math.sqrt(ddx*ddx+ddz*ddz);
  if (hd<1) return [{ax,ay,az,bx,by,bz,radius}];
  // Single waypoint with mild jitter — keeps tunnels direct and avoids room collisions
  const t=0.5;
  let wpx=ax+ddx*t, wpz=az+ddz*t;
  const perpX=-ddz/hd, perpZ=ddx/hd;
  const jitter=Math.min(hd*0.12,8);
  wpx+=perpX*rng.float(-jitter,jitter);
  wpz+=perpZ*rng.float(-jitter,jitter);
  const safe=pushOutsideRooms(wpx,wpz,allNodes,radius+3);
  wpx=safe.x; wpz=safe.z;
  const wpy=Math.round(ay+(by-ay)*0.5);
  const pts=[{x:ax,y:ay,z:az},{x:wpx,y:wpy,z:wpz},{x:bx,y:by,z:bz}];
  const segs=[];
  for (let i=0;i<pts.length-1;i++) {
    const p=pts[i],q=pts[i+1];
    const sh=Math.sqrt((q.x-p.x)**2+(q.z-p.z)**2);
    let qy=q.y;
    if (sh>0&&Math.abs(qy-p.y)/sh>0.4)
      qy=p.y+(qy>p.y?1:-1)*Math.floor(sh*0.4);
    segs.push({ax:p.x,ay:p.y,az:p.z,bx:q.x,by:qy,bz:q.z,radius});
  }
  return segs;
}

function makeRoom(rng,type,x,z,originY,originX,originZ) {
  let rx,rz,domeH;
  switch(type) {
    case NodeType.BOSS:      rx=rng.float(14,20); rz=rng.float(14,20); domeH=rng.float(9,13); break;
    case NodeType.CAVERN:    rx=rng.float(6,10);  rz=rng.float(6,10);  domeH=rng.float(4,7);  break;
    case NodeType.ENTRANCE:
    case NodeType.RECEPTION: rx=7; rz=7; domeH=6; break;
    case NodeType.STAIRWELL: rx=4; rz=4; domeH=5; break;
    case NodeType.DEAD_END:  rx=rng.float(3,5);  rz=rng.float(3,5);  domeH=rng.float(3,5);  break;
    default:                 rx=rng.float(4,6);  rz=rng.float(4,6);  domeH=rng.float(3,5);  break;
  }
  const isFixed=(type===NodeType.ENTRANCE||type===NodeType.RECEPTION);
  const noiseSeed=isFixed?0:rng.int(1,0xffff);
  const maxLift=isFixed?0:Math.max(0,Math.min(3,FLOOR_HEIGHT-Math.ceil(domeH)-4));
  const floorY=originY+1+(isFixed?0:rng.int(0,maxLift));
  return {
    id:null,type,
    x:clamp(x,originX+MARGIN+rx,originX+FLOOR_SIZE-MARGIN-rx),
    y:floorY,
    z:clamp(z,originZ+MARGIN+rz,originZ+FLOOR_SIZE-MARGIN-rz),
    rx,rz,domeH,ry:domeH,noiseSeed,edges:[],
  };
}

function connectNodes(rng,a,b,edges,radius,allNodes) {
  // Enforce minimum passable radius
  const r=Math.max(radius??MIN_TUNNEL_R, MIN_TUNNEL_R);
  const dxAB=b.x-a.x,dzAB=b.z-a.z;
  const eA=roomSurfacePoint(a, dxAB, dzAB);
  const eB=roomSurfacePoint(b,-dxAB,-dzAB);
  const segs=buildTunnelSegments(new RNG(rng.int(1,0xffffff)),
    eA.x,a.y,eA.z, eB.x,b.y,eB.z, r, allNodes);
  const edge={
    id:edges.length,type:EdgeType.TUNNEL,from:a.id,to:b.id,radius:r,
    ax:eA.x,ay:a.y,az:eA.z,bx:eB.x,by:b.y,bz:eB.z,segments:segs,
  };
  edges.push(edge);
  a.edges.push(edge.id);
  b.edges.push(edge.id);
  return edge;
}

// BFS from start node, return set of reachable IDs
function bfsReachable(startId,nodes,edges) {
  const visited=new Set([startId]);
  const q=[startId];
  while (q.length>0) {
    const cur=q.shift();
    const cn=nodes.find(n=>n.id===cur); if (!cn) continue;
    for (const eid of cn.edges) {
      const e=edges[eid]; if (!e) continue;
      const nb=e.from===cur?e.to:e.from;
      if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
    }
  }
  return visited;
}

export function planFloor(originX,originY,originZ,entrancePositions=[]) {
  const seed=(Math.random()*0xffffffff)>>>0;
  const rng=new RNG(seed);
  const targetRooms=rng.int(18,28);
  const nodes=[],edges=[];
  let nextId=0;
  const centreZ=originZ+FLOOR_SIZE*0.5;

  // ── Entrance / Reception ──────────────────────────────────────────────────
  let entrance;
  if (entrancePositions.length===0) {
    entrance={
      id:nextId++,type:NodeType.ENTRANCE,
      x:originX+MARGIN+8, y:originY+1, z:centreZ,
      rx:7,rz:7,domeH:6,ry:6,noiseSeed:0,edges:[],
      isEntrance:true, needsWestWallHole:true,
    };
  } else {
    const ep=entrancePositions[0];
    entrance={
      id:nextId++,type:NodeType.RECEPTION,
      x:clamp(ep.x,originX+MARGIN+7,originX+FLOOR_SIZE-MARGIN-7),
      y:originY+1,
      z:clamp(ep.z,originZ+MARGIN+7,originZ+FLOOR_SIZE-MARGIN-7),
      rx:7,rz:7,domeH:6,ry:6,noiseSeed:0,edges:[],
      isEntrance:true,
    };
  }
  nodes.push(entrance);
  const frontier=[entrance];

  // ── Grow spanning tree of rooms ───────────────────────────────────────────
  // Every room added gets an edge from its parent → guaranteed connected tree.
  let bossPlaced=false;
  let attempts=0;

  while (nodes.length<targetRooms&&attempts<10000) {
    attempts++;
    const parent=rng.pick(frontier);

    let type;
    if (!bossPlaced&&rng.chance(0.08+(nodes.length>targetRooms*0.5?0.18:0))) {
      type=NodeType.BOSS;
    } else if (nodes.length>targetRooms*0.8&&rng.chance(0.2)) {
      type=NodeType.DEAD_END;
    } else {
      type=rng.chance(0.45)?NodeType.CAVERN:NodeType.JUNCTION;
    }

    const step=type===NodeType.BOSS?rng.float(35,60):
               type===NodeType.CAVERN?rng.float(22,42):rng.float(14,28);
    const ang=rng.float(0,Math.PI*2);
    const node=makeRoom(rng,type,
      parent.x+Math.cos(ang)*step,
      parent.z+Math.sin(ang)*step,
      originY,originX,originZ);
    node.id=nextId++;

    let ov=false;
    for (const e of nodes) { if (roomsOverlap(node,e)) { ov=true; break; } }
    if (ov) continue;
    if (node.x-node.rx<originX+2||node.x+node.rx>originX+FLOOR_SIZE-2||
        node.z-node.rz<originZ+2||node.z+node.rz>originZ+FLOOR_SIZE-2) continue;

    nodes.push(node);
    if (type===NodeType.BOSS) bossPlaced=true;
    // Always connect from parent → all rooms reachable by construction
    connectNodes(rng,parent,node,edges,MIN_TUNNEL_R+rng.float(0,0.5),nodes);
    if (type!==NodeType.DEAD_END) frontier.push(node);

    // Optional extra cross-links for loops (never the only connection)
    if (rng.chance(0.12)&&nodes.length>5) {
      const nearby=nodes.filter(n=>n.id!==node.id&&n.id!==parent.id&&dist2(n,node)<55);
      if (nearby.length) {
        const tgt=rng.pick(nearby);
        const lnk=edges.some(e=>(e.from===node.id&&e.to===tgt.id)||(e.from===tgt.id&&e.to===node.id));
        if (!lnk) connectNodes(rng,node,tgt,edges,MIN_TUNNEL_R,nodes);
      }
    }
  }

  const bossNodes=nodes.filter(n=>n.type===NodeType.BOSS);
  if (bossNodes.length===0) return null;

  // ── Exit stairwell beside furthest boss ───────────────────────────────────
  const exitBoss=[...bossNodes].sort((a,b)=>dist2(b,entrance)-dist2(a,entrance))[0];
  const awayAngle=Math.atan2(exitBoss.z-entrance.z,exitBoss.x-entrance.x);
  const swDist=exitBoss.rx+rng.float(3,7);
  const swX=clamp(exitBoss.x+Math.cos(awayAngle)*swDist,originX+MARGIN+4,originX+FLOOR_SIZE-MARGIN-4);
  const swZ=clamp(exitBoss.z+Math.sin(awayAngle)*swDist,originZ+MARGIN+4,originZ+FLOOR_SIZE-MARGIN-4);

  const stairwell={
    id:nextId++,type:NodeType.STAIRWELL,
    x:swX,y:originY+1,z:swZ,
    rx:4,rz:4,domeH:5,ry:5,
    noiseSeed:rng.int(1,0xffff),edges:[],isExit:true,
  };
  nodes.push(stairwell);
  connectNodes(rng,exitBoss,stairwell,edges,2.0,nodes);

  // ── Final reachability check — bridge any stragglers ─────────────────────
  // Run AFTER stairwell is added so it's included in connectivity
  const visited=bfsReachable(entrance.id,nodes,edges);
  for (const u of nodes.filter(n=>!visited.has(n.id))) {
    const near=[...nodes].filter(n=>visited.has(n.id))
      .sort((a,b)=>dist2(a,u)-dist2(b,u))[0];
    if (!near) continue;
    connectNodes(rng,near,u,edges,MIN_TUNNEL_R,nodes);
    // Propagate reachability from u
    const newReach=bfsReachable(u.id,nodes,edges);
    for (const id of newReach) visited.add(id);
  }

  return {nodes,edges,entrance,stairwells:[stairwell],exitBoss,entrancePositions,seed,drops:[]};
}
