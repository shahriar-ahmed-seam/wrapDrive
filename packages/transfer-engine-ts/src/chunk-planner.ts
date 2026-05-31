/**
 * Chunk planning.
 *
 * {@link planChunks} splits a file of a given size into an ordered list of
 * {@link ChunkRef}s that exactly tile `[0, fileSize)` — contiguous, no gaps, no
 * overlaps. Because each chunk carries its absolute byte offset, the receiver
 * can write chunks in any order straight to their final positions, which is
 * what makes parallel sending safe (reassembly is implicit).
 *
 * See section 6.1 of `protocol-spec/wrapdrive-protocol-v1.md`.
 */

import type { ChunkRef } from '@wrapdrive/protocol';

/**
 * Plan the chunks for a file.
 *
 * Postconditions (verified by property tests):
 *  - the chunk lengths sum exactly to `fileSize`;
 *  - the ranges tile `[0, fileSize)` with no gaps and no overlaps;
 *  - indices are zero-based and contiguous, and `offset[i]` equals the sum of
 *    all preceding lengths;
 *  - every chunk except the last has `length === chunkSize`, and the last
 *    chunk's length is in `(0, chunkSize]`;
 *  - `fileSize === 0` yields an empty array.
 *
 * @param fileSize  total file size in bytes; must be `>= 0`
 * @param chunkSize maximum chunk size in bytes; must be `> 0`
 * @throws RangeError if `fileSize < 0` or `chunkSize <= 0`
 */
export function planChunks(fileSize: number, chunkSize: number): ChunkRef[] {
  if (!Number.isInteger(fileSize) || fileSize < 0) {
    throw new RangeError('fileSize must be a non-negative integer');
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer');
  }

  const chunks: ChunkRef[] = [];
  let offset = 0;
  let index = 0;

  while (offset < fileSize) {
    const length = Math.min(chunkSize, fileSize - offset);
    chunks.push({ index, offset, length });
    offset += length;
    index += 1;
  }

  return chunks;
}
