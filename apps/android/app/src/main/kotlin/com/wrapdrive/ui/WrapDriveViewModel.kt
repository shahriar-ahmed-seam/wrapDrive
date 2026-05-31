package com.wrapdrive.ui

import androidx.lifecycle.ViewModel
import com.wrapdrive.net.Peer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A consent prompt surfaced to the user. */
data class ConsentUi(val fromAlias: String, val fileSummary: String, val pinRequired: Boolean)

/** Live transfer progress for the UI. */
data class TransferUi(
    val fileName: String,
    val fraction: Float,
    val bytesPerSecond: Long,
    val state: String,
)

/** The whole-screen UI state. */
data class WrapDriveUiState(
    val selfAlias: String = "This Device",
    val peers: List<Peer> = emptyList(),
    val consent: ConsentUi? = null,
    val transfer: TransferUi? = null,
    val lastCompleted: String? = null,
    val error: String? = null,
)

/**
 * Holds the WrapDrive UI state as a [StateFlow]. The Activity wires discovery,
 * server, and transfer callbacks into the mutators here; Compose observes the
 * single [state].
 */
class WrapDriveViewModel : ViewModel() {
    private val _state = MutableStateFlow(WrapDriveUiState())
    val state: StateFlow<WrapDriveUiState> = _state.asStateFlow()

    fun setSelfAlias(alias: String) {
        _state.value = _state.value.copy(selfAlias = alias)
    }

    fun setPeers(peers: List<Peer>) {
        _state.value = _state.value.copy(peers = peers)
    }

    fun showConsent(consent: ConsentUi?) {
        _state.value = _state.value.copy(consent = consent)
    }

    fun updateTransfer(transfer: TransferUi?) {
        _state.value = _state.value.copy(transfer = transfer)
    }

    fun markCompleted(name: String) {
        _state.value = _state.value.copy(lastCompleted = name, transfer = null)
    }
}
