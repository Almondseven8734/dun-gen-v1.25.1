// persistence.js - Save/load floor number and staircase location using dynamic properties

const PROPERTY_KEY = 'dungeon:floors';

export function saveFloorData(world, floorIndex, staircaseX, staircaseY, staircaseZ) {
  let allFloors = {};
  try {
    const raw = world.getDynamicProperty(PROPERTY_KEY);
    if (raw) allFloors = JSON.parse(raw);
  } catch (e) {}

  allFloors[floorIndex] = {
    floor: floorIndex,
    staircase: { x: staircaseX, y: staircaseY, z: staircaseZ },
  };

  world.setDynamicProperty(PROPERTY_KEY, JSON.stringify(allFloors));
}

export function loadFloorData(world, floorIndex) {
  try {
    const raw = world.getDynamicProperty(PROPERTY_KEY);
    if (!raw) return null;
    const allFloors = JSON.parse(raw);
    return allFloors[floorIndex] ?? null;
  } catch (e) {
    return null;
  }
}

export function loadAllFloors(world) {
  try {
    const raw = world.getDynamicProperty(PROPERTY_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

export function clearDungeonData(world) {
  world.setDynamicProperty(PROPERTY_KEY, JSON.stringify({}));
}
