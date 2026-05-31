/**
 * Error types raised by the transfer engine.
 *
 * These are distinguishable so that protocol servers can map them to the right
 * HTTP responses (e.g. a bounds error to 400, an integrity error to a failed
 * finalize) without string matching.
 */

/** Base class for all transfer-engine errors. */
export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The destination could not be pre-allocated to the declared size. */
export class AllocationError extends TransferError {}

/** A chunk's offset/length/body-length failed validation; nothing was written. */
export class ChunkBoundsError extends TransferError {}

/** The computed whole-file hash did not match the declared hash. */
export class IntegrityError extends TransferError {}

/** A transfer was cancelled or a session terminated before completion. */
export class TransferAbortedError extends TransferError {}
