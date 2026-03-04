/**
 * rng.js — Seeded RNG using mulberry32 algorithm
 */

export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
  }

  next() {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Random float between min and max
  float(min, max) {
    return min + this.next() * (max - min);
  }

  // Random integer between min and max (inclusive)
  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }

  // Random element from array
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  // Random boolean with given probability (0-1)
  chance(probability) {
    return this.next() < probability;
  }

  // Shuffle array in place
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
