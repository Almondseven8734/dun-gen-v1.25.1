// sdfShapes.js  v17
// Tunnels are Y-clamped to prevent punching room ceilings.
// tunnelMinBoxSDF uses per-segment floor Y (min endpoint), not centerline Y,
// so the 1×2 guaranteed passage always aligns to the ground.

function ellipsoidSDF(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const dx=(px-cx)/rx, dy=(py-cy)/ry, dz=(pz-cz)/rz;
  return Math.sqrt(dx*dx+dy*dy+dz*dz)-1.0;
}

function irregularRoomSDF(px, py, pz, cx, floorY, cz, rx, domeH, rz, ns) {
  if (py < floorY) return 1.0;
  const angle=Math.atan2(pz-cz,px-cx);
  const p1=((ns    )&0xff)/255*Math.PI*2;
  const p2=((ns>> 8)&0xff)/255*Math.PI*2;
  const p3=((ns>>16)&0xff)/255*Math.PI*2;
  const amp=((ns>>24)&0x0f)/15*0.18+0.05;
  const n=1+amp*(0.5*Math.sin(2*angle+p1)+0.3*Math.sin(3*angle+p2)+0.2*Math.sin(5*angle+p3));
  return ellipsoidSDF(px,py,pz,cx,floorY,cz,rx*n,domeH,rz*n);
}

function capsuleSDF(px,py,pz,ax,ay,az,bx,by,bz,r) {
  const abx=bx-ax,aby=by-ay,abz=bz-az,apx=px-ax,apy=py-ay,apz=pz-az;
  const ab2=abx*abx+aby*aby+abz*abz;
  const t=ab2===0?0:Math.max(0,Math.min(1,(apx*abx+apy*aby+apz*abz)/ab2));
  const dx=apx-t*abx,dy=apy-t*aby,dz=apz-t*abz;
  return Math.sqrt(dx*dx+dy*dy+dz*dz)-r;
}

// Tunnel: Y-clamped capsule. Only carves between floor (min Y endpoint) and ceil (max Y endpoint + 2).
function tunnelSegSDF(px,py,pz,ax,ay,az,bx,by,bz,r) {
  const yLo=Math.min(ay,by), yHi=Math.max(ay,by)+2;
  if (py<yLo||py>yHi) return 1.0;
  return capsuleSDF(px,py,pz,ax,ay,az,bx,by,bz,r);
}

// Minimum guaranteed 1-wide × 2-tall box along tunnel segment.
// Floor of box = min(ay,by). Box is 1 block wide XZ, 2 blocks tall upward from floor.
function tunnelMinBoxSDF(px,py,pz,ax,ay,az,bx,by,bz) {
  const segFloor=Math.min(ay,by);
  // Only carve in 2-block band above segment floor
  if (py < segFloor || py > segFloor+1) return 1.0;
  // XZ: project onto segment ignoring Y
  const abx=bx-ax,abz=bz-az,apx=px-ax,apz=pz-az;
  const ab2=abx*abx+abz*abz;
  const t=ab2===0?0:Math.max(0,Math.min(1,(apx*abx+apz*abz)/ab2));
  const cpx=ax+t*abx, cpz=az+t*abz;
  const dxz=Math.sqrt((px-cpx)**2+(pz-cpz)**2);
  return dxz-0.5; // inside when dxz<=0.5 (1 block wide)
}

export function buildShapeGrid(shapes,originX,originZ,floorSize) {
  const CELL=8, CELLS=Math.ceil(floorSize/CELL);
  const grid=Array.from({length:CELLS*CELLS},()=>[]);
  for (const s of shapes) {
    let minX,maxX,minZ,maxZ;
    if (s.type==='room') {
      const r=s.rx+2;
      minX=(s.cx-originX-r)/CELL|0; maxX=(s.cx-originX+r)/CELL|0;
      minZ=(s.cz-originZ-r)/CELL|0; maxZ=(s.cz-originZ+r)/CELL|0;
    } else if (s.type==='tunnel') {
      let mnX=1e9,mxX=-1e9,mnZ=1e9,mxZ=-1e9;
      for (const g of s.segments) {
        mnX=Math.min(mnX,g.ax-originX,g.bx-originX);
        mxX=Math.max(mxX,g.ax-originX,g.bx-originX);
        mnZ=Math.min(mnZ,g.az-originZ,g.bz-originZ);
        mxZ=Math.max(mxZ,g.az-originZ,g.bz-originZ);
      }
      const r=s.radius+2;
      minX=(mnX-r)/CELL|0; maxX=(mxX+r)/CELL|0;
      minZ=(mnZ-r)/CELL|0; maxZ=(mxZ+r)/CELL|0;
    } else continue;
    for (let cx=Math.max(0,minX);cx<=Math.min(CELLS-1,maxX);cx++)
      for (let cz=Math.max(0,minZ);cz<=Math.min(CELLS-1,maxZ);cz++)
        grid[cx*CELLS+cz].push(s);
  }
  return { getColumn(lx,lz) {
    const cx=lx/CELL|0, cz=lz/CELL|0;
    if (cx<0||cx>=CELLS||cz<0||cz>=CELLS) return [];
    return grid[cx*CELLS+cz];
  }};
}

export function evalColumn(worldX,worldZ,originY,floorHeight,columnShapes) {
  const result=new Uint8Array(floorHeight);
  for (const s of columnShapes) {
    if (s.type==='room') {
      const ex=(worldX-s.cx)/s.rx, ez=(worldZ-s.cz)/s.rz;
      if (ex*ex+ez*ez>1.5) continue;
    }
    for (let ly=0;ly<floorHeight;ly++) {
      if (result[ly]) continue;
      const wy=originY+ly;
      let d=Infinity;
      if (s.type==='room') {
        d=irregularRoomSDF(worldX,wy,worldZ,s.cx,s.cy,s.cz,s.rx,s.ry,s.rz,s.ns);
      } else if (s.type==='tunnel') {
        for (const seg of s.segments) {
          const dc=tunnelSegSDF(worldX,wy,worldZ,seg.ax,seg.ay,seg.az,seg.bx,seg.by,seg.bz,seg.radius);
          const db=tunnelMinBoxSDF(worldX,wy,worldZ,seg.ax,seg.ay,seg.az,seg.bx,seg.by,seg.bz);
          const sd=Math.min(dc,db);
          if (sd<d) d=sd;
          if (d<=0) break;
        }
      }
      if (d<=0) result[ly]=1;
    }
  }
  return result;
}
