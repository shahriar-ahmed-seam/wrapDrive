package com.wrapdrive.core.transfer

import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

/**
 * JVM/Android [FileAdapter] backed by [RandomAccessFile].
 *
 * Pre-allocates a `.wdpart` file with `setLength(total)` and performs positional
 * writes via `seek(offset)` + `write`, so chunks written in any order land at
 * their final byte positions. Commit renames the part file to its destination.
 * On Android, callers can pass an app-private cache/files path; SAF/MediaStore
 * publishing is layered on top by copying the committed file to the chosen URI.
 */
class FileSystemFileAdapter(private val destinationDir: File) : FileAdapter {
    override fun openSparse(name: String, totalSize: Long): SparseFileHandle {
        val finalFile = File(destinationDir, sanitize(name))
        val partFile = File(destinationDir, "${sanitize(name)}.wdpart")
        destinationDir.mkdirs()
        val raf = RandomAccessFile(partFile, "rw")
        raf.setLength(totalSize)
        return FsSparseHandle(raf, partFile, finalFile)
    }

    /** Strip path separators and traversal from a received file name. */
    private fun sanitize(name: String): String =
        name.replace('\\', '/').substringAfterLast('/').ifEmpty { "wrapdrive-file" }

    private class FsSparseHandle(
        private val raf: RandomAccessFile,
        private val partFile: File,
        private val finalFile: File,
    ) : SparseFileHandle {
        private val lock = Any()
        private var committed = false

        override fun writeAt(offset: Long, data: ByteArray) {
            synchronized(lock) {
                raf.seek(offset)
                raf.write(data)
            }
        }

        override fun sha256(): String {
            synchronized(lock) {
                raf.fd.sync()
            }
            val digest = MessageDigest.getInstance("SHA-256")
            partFile.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }

        override fun commit() {
            synchronized(lock) {
                raf.fd.sync()
                raf.close()
                finalFile.delete()
                if (!partFile.renameTo(finalFile)) {
                    partFile.copyTo(finalFile, overwrite = true)
                    partFile.delete()
                }
                committed = true
            }
        }

        override fun close() {
            synchronized(lock) {
                if (committed) return
                runCatching { raf.close() }
                partFile.delete()
            }
        }
    }
}

/** A [LocalFile] backed by a filesystem [File], reading ranges on demand. */
class FileSystemLocalFile(private val file: File) : LocalFile {
    override val size: Long get() = file.length()

    override fun readRange(offset: Long, length: Int): ByteArray {
        if (length == 0) return ByteArray(0)
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            val buffer = ByteArray(length)
            raf.readFully(buffer)
            return buffer
        }
    }
}
