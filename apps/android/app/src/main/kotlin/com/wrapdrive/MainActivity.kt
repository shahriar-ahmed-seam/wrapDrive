package com.wrapdrive

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.wrapdrive.net.AppContainer
import com.wrapdrive.ui.WrapDriveApp
import com.wrapdrive.ui.WrapDriveViewModel
import kotlinx.coroutines.launch

/**
 * Single-activity entry point. Builds the [AppContainer] (discovery, server,
 * sender) and binds it to the [WrapDriveViewModel] that drives the Compose UI.
 */
class MainActivity : ComponentActivity() {
    private var container: AppContainer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Install the crash reporter before anything else so any startup failure
        // is captured and shown on screen instead of a silent crash.
        CrashReporter.install(this)
        enableEdgeToEdge()

        val vm = ViewModelProvider(this)[WrapDriveViewModel::class.java]

        // Build and start the networking container once, off the composition.
        // Any failure is logged rather than crashing the UI.
        try {
            val c = AppContainer(applicationContext, vm, lifecycleScope)
            c.start()
            container = c
        } catch (t: Throwable) {
            Log.e("WrapDrive", "container init failed", t)
        }

        setContent {
            val state by vm.state.collectAsState()
            WrapDriveApp(
                state = state,
                onPeerTap = { peer -> lifecycleScope.launch { container?.sendDemoFile(peer) } },
                onConsentResult = { accepted -> container?.resolveConsent(accepted) },
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        container?.let { c -> lifecycleScope.launch { c.stop() } }
    }
}
