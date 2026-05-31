package com.wrapdrive

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import com.wrapdrive.net.AppContainer
import com.wrapdrive.ui.WrapDriveApp
import com.wrapdrive.ui.WrapDriveUiState
import kotlinx.coroutines.launch

/**
 * Single-activity entry point. Uses the process-wide [AppContainer] singleton
 * (so Activity recreation never starts a second server) and renders the Compose
 * UI from the container's own state flows.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Capture any uncaught exception and show it on screen, before anything else.
        CrashReporter.install(this)
        enableEdgeToEdge()

        val container =
            runCatching {
                    AppContainer.getInstance(applicationContext, lifecycleScope).also { it.start() }
                }
                .onFailure { Log.e("WrapDrive", "container init failed", it) }
                .getOrNull()

        setContent {
            if (container == null) {
                WrapDriveApp(WrapDriveUiState(selfAlias = "WrapDrive"), {}, {})
            } else {
                val peers by container.uiPeers.collectAsState()
                val consent by container.uiConsent.collectAsState()
                val transfer by container.uiTransfer.collectAsState()
                val error by container.uiError.collectAsState()

                WrapDriveApp(
                    state =
                        WrapDriveUiState(
                            selfAlias = container.selfAlias,
                            peers = peers,
                            consent = consent,
                            transfer = transfer,
                            error = error,
                        ),
                    onPeerTap = { peer ->
                        lifecycleScope.launch {
                            runCatching { container.sendDemoFile(peer) }
                                .onFailure { Log.e("WrapDrive", "send failed", it) }
                        }
                    },
                    onConsentResult = { accepted -> container.resolveConsent(accepted) },
                )
            }
        }
    }
}
