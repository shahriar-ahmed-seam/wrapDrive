package com.wrapdrive

import android.content.Context
import android.content.Intent
import java.io.File
import kotlin.system.exitProcess

/**
 * Captures uncaught exceptions so failures on real devices are visible without
 * a USB cable.
 *
 * On any uncaught throwable it writes the full stack trace to
 * `filesDir/last_crash.txt` and launches [CrashActivity] to display it on
 * screen, then exits. The previous handler is preserved for logcat.
 */
object CrashReporter {
    private const val CRASH_FILE = "last_crash.txt"

    fun install(context: Context) {
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            val trace = buildString {
                append("WrapDrive crash\n")
                append("Thread: ${thread.name}\n")
                append("Device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\n")
                append("Android: ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})\n")
                append("ABIs: ${android.os.Build.SUPPORTED_ABIS.joinToString()}\n\n")
                append(throwable.stackTraceToString())
            }
            runCatching { File(appContext.filesDir, CRASH_FILE).writeText(trace) }
            runCatching {
                val intent =
                    Intent(appContext, CrashActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        putExtra(CrashActivity.EXTRA_TRACE, trace)
                    }
                appContext.startActivity(intent)
            }
            previous?.uncaughtException(thread, throwable)
            exitProcess(1)
        }
    }

    /** Read a previously saved crash trace, if any. */
    fun lastCrash(context: Context): String? {
        val file = File(context.filesDir, CRASH_FILE)
        return if (file.exists()) file.readText() else null
    }

    /** Clear a saved crash trace. */
    fun clear(context: Context) {
        runCatching { File(context.filesDir, CRASH_FILE).delete() }
    }
}
