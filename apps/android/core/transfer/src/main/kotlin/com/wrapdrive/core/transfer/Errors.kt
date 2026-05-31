package com.wrapdrive.core.transfer

/** Base class for transfer-engine errors. */
sealed class TransferException(message: String) : Exception(message)

/** The destination could not be pre-allocated to the declared size. */
class AllocationException(message: String) : TransferException(message)

/** A chunk's offset/length/body-length failed validation; nothing was written. */
class ChunkBoundsException(message: String) : TransferException(message)

/** The computed whole-file hash did not match the declared hash. */
class IntegrityException(message: String) : TransferException(message)

/** A transfer was cancelled or a session terminated before completion. */
class TransferAbortedException(message: String) : TransferException(message)
