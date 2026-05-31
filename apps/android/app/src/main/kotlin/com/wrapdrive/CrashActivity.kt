package com.wrapdrive

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * A deliberately minimal, Compose-free activity that displays a crash trace on
 * screen so it can be read or screenshotted without a USB cable. It uses only
 * framework views so it cannot fail from the same cause as the main app.
 */
class CrashActivity : Activity() {
    companion object {
        const val EXTRA_TRACE = "trace"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val trace = intent.getStringExtra(EXTRA_TRACE) ?: "No trace captured."

        val root =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(0xFF0E1117.toInt())
                setPadding(32, 64, 32, 32)
            }
        val title =
            TextView(this).apply {
                text = "WrapDrive crashed — share this with the developer"
                setTextColor(0xFFF85149.toInt())
                textSize = 16f
                gravity = Gravity.START
            }
        val body =
            TextView(this).apply {
                text = trace
                setTextColor(0xFFE6EDF3.toInt())
                textSize = 12f
                setTextIsSelectable(true)
                typeface = android.graphics.Typeface.MONOSPACE
            }
        val scroll = ScrollView(this).apply { addView(body) }

        root.addView(title)
        root.addView(scroll)
        setContentView(root)
    }
}
