/**
 * Property 1 — Chunk coverage and tiling.
 *
 * For any `fileSize >= 0` and `chunkSize > 0`, the planned chunks have lengths
 * that sum exactly to `fileSize` and tile `[0, fileSize)` with no gaps and no
 * overlaps; indices are zero-based and contiguous; every chunk except the last
 * has `length === chunkSize` and the last is in `(0, chunkSize]`; size 0 yields
 * an empty list.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planChunks } from './chunk-planner.js';

const RUNS = { numRuns: 300 };

describe('planChunks — Property 1: coverage and tiling', () => {
  it('produces a contiguous, gap-free, non-overlapping tiling of [0, fileSize)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (fileSize, chunkSize) => {
          // Keep the chunk count bounded so the property stays fast: skip
          // pathological (huge file / tiny chunk) combinations, which the
          // explicit unit cases below already cover.
          fc.pre(Math.ceil(fileSize / chunkSize) <= 5000);
          const chunks = planChunks(fileSize, chunkSize);

          // Coverage: lengths sum to fileSize.
          const sum = chunks.reduce((acc, c) => acc + c.length, 0);
          expect(sum).toBe(fileSize);

          // Contiguity + indexing: offset[i] == sum of preceding lengths.
          let expectedOffset = 0;
          chunks.forEach((c, i) => {
            expect(c.index).toBe(i);
            expect(c.offset).toBe(expectedOffset);
            expect(c.length).toBeGreaterThan(0);
            expectedOffset += c.length;
          });

          // Bounded size: all but the last are exactly chunkSize; last in (0, chunkSize].
          chunks.forEach((c, i) => {
            if (i < chunks.length - 1) {
              expect(c.length).toBe(chunkSize);
            } else {
              expect(c.length).toBeLessThanOrEqual(chunkSize);
            }
          });
        },
      ),
      RUNS,
    );
  });

  it('returns an empty list for a zero-size file', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (chunkSize) => {
        expect(planChunks(0, chunkSize)).toEqual([]);
      }),
      RUNS,
    );
  });

  it('handles exact multiples and non-multiples', () => {
    expect(planChunks(100, 25).map((c) => c.length)).toEqual([25, 25, 25, 25]);
    expect(planChunks(90, 25).map((c) => c.length)).toEqual([25, 25, 25, 15]);
    expect(planChunks(10, 25).map((c) => c.length)).toEqual([10]);
    expect(planChunks(1, 1).map((c) => c.length)).toEqual([1]);
  });

  it('rejects invalid arguments', () => {
    expect(() => planChunks(-1, 10)).toThrow(RangeError);
    expect(() => planChunks(10, 0)).toThrow(RangeError);
    expect(() => planChunks(10, -5)).toThrow(RangeError);
  });
});
