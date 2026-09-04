import { ValidationError } from '../lib/errors.js';

/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * A simple, fast 32-bit PRNG with a period of 2^32. Good enough for
 * synthetic data generation where cryptographic randomness is not required.
 * The same seed always produces the same sequence.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Return the next 32-bit unsigned integer. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Return a float in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Return an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick a random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(0, arr.length - 1)]!;
  }

  /** Pick a random element weighted by probabilities (must sum to 1). */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length) {
      throw new ValidationError('items and weights must have the same length');
    }
    const r = this.next();
    let cumulative = 0;
    for (let i = 0; i < items.length; i++) {
      cumulative += weights[i]!;
      if (r < cumulative) {
        return items[i]!;
      }
    }
    return items[items.length - 1]!;
  }

  /** Shuffle an array in place (Fisher-Yates) and return it. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}
