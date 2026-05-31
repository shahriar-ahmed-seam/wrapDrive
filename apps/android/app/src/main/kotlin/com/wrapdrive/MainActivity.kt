package com.wrapdrive

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.wrapdrive.net.AppContainer
import com.wrapdrive.ui.WrapDriveApp
import com.wrapdrive.ui.WrapDriveViewModel
import kotlinx.coroutines.launch

/**
 * Single-activity entry point. Builds the [AppContainer] (discovery, server,
 * sender) and binds it to the [WrapDriveViewModel] that drives the Compose UI.
 */
class MainActivity : ComponentActivity() {
    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val vm: WrapDriveViewModel = viewModel()
            val state by vm.state.collectAsState()

            if (!::container.isInitialized) {
                container = AppContainer(applicationContext, vm, lifecycleScope)
                container.start()
            }

            WrapDriveApp(
                state = state,
                onPeerTap = { peer -> lifecycleScope.launch { container.sendDemoFile(peer) } },
                onConsentResult = { accepted -> container.resolveConsent(accepted) },
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::container.isInitialized) {
            lifecycleScope.launch { container.stop() }
        }
    }
}
