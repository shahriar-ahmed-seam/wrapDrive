package com.wrapdrive.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.wrapdrive.core.protocol.DeviceType
import com.wrapdrive.designsystem.WrapDriveTheme
import com.wrapdrive.designsystem.components.DiscoveryRadar
import com.wrapdrive.designsystem.components.PeerCard
import com.wrapdrive.designsystem.components.ProgressRing
import com.wrapdrive.net.Peer

/** Root composable rendering the discovery, transfer, and consent surfaces. */
@Composable
fun WrapDriveApp(
    state: WrapDriveUiState,
    onPeerTap: (Peer) -> Unit,
    onConsentResult: (accepted: Boolean) -> Unit,
) {
    WrapDriveTheme {
        Scaffold { padding ->
            Box(
                modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp),
                contentAlignment = Alignment.TopCenter,
            ) {
                when {
                    state.transfer != null -> TransferView(state)
                    else -> DiscoveryView(state, onPeerTap)
                }

                state.consent?.let { consent ->
                    ConsentDialog(consent, onConsentResult)
                }

                state.error?.let { error ->
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun DiscoveryView(state: WrapDriveUiState, onPeerTap: (Peer) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "WrapDrive",
            style = MaterialTheme.typography.displayMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = "Nearby devices on your network",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (state.peers.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxWidth().size(260.dp),
                contentAlignment = Alignment.Center,
            ) {
                DiscoveryRadar()
                Text(
                    text = "Searching for devices…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.peers) { peer ->
                    PeerCard(
                        alias = peer.info.alias,
                        detail = "${peer.address} · tap to send",
                        icon = iconFor(peer.info.deviceType),
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { onPeerTap(peer) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TransferView(state: WrapDriveUiState) {
    val transfer = state.transfer ?: return
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        ProgressRing(fraction = transfer.fraction, diameter = 140.dp)
        Text(transfer.fileName, style = MaterialTheme.typography.titleLarge)
        Text(
            "${formatSpeed(transfer.bytesPerSecond)} · ${transfer.state}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ConsentDialog(consent: ConsentUi, onResult: (Boolean) -> Unit) {
    AlertDialog(
        onDismissRequest = { onResult(false) },
        title = { Text("Incoming transfer") },
        text = {
            Text("${consent.fromAlias} wants to send:\n${consent.fileSummary}")
        },
        confirmButton = { Button(onClick = { onResult(true) }) { Text("Accept") } },
        dismissButton = { TextButton(onClick = { onResult(false) }) { Text("Decline") } },
    )
}

private fun iconFor(type: DeviceType?): ImageVector =
    when (type) {
        DeviceType.desktop, DeviceType.server, DeviceType.headless -> Icons.Filled.Computer
        DeviceType.web -> Icons.Filled.Public
        else -> Icons.Filled.PhoneAndroid
    }

private fun formatSpeed(bytesPerSecond: Long): String {
    if (bytesPerSecond <= 0) return "—"
    val mb = bytesPerSecond / (1024.0 * 1024.0)
    return if (mb >= 1) "%.1f MB/s".format(mb) else "%.0f KB/s".format(bytesPerSecond / 1024.0)
}
