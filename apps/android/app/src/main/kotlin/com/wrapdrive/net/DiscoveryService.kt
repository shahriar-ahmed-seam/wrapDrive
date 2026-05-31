package com.wrapdrive.net

import com.wrapdrive.core.protocol.Capabilities
import com.wrapdrive.core.protocol.DeviceInfo
import com.wrapdrive.core.protocol.WrapDriveProtocol
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.MulticastSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * LAN discovery via UDP multicast announcements with a TTL-pruned peer list.
 *
 * Sends a JSON announcement to the multicast group on start and every 5s, and
 * listens for announcements from other devices, excluding itself by
 * fingerprint. Peers unseen for 30s are pruned. The `/register` HTTP exchange
 * (handled by the server) updates the same peer list via [onRegister].
 *
 * Multicast can be unreliable on emulators; the app also supports manual add by
 * IP, which drives the same registration path.
 */
class DiscoveryService(
    private val self: DeviceInfo,
    private val capabilities: Capabilities,
    private val scope: CoroutineScope,
    private val onAnnouncementPeer: suspend (address: String) -> Unit = {},
) {
    private companion object {
        const val ANNOUNCE_INTERVAL_MS = 5_000L
        const val PEER_TTL_MS = 30_000L
        const val PRUNE_INTERVAL_MS = 5_000L
    }

    private val _peers = MutableStateFlow<List<Peer>>(emptyList())
    val peers: StateFlow<List<Peer>> = _peers.asStateFlow()

    private val peerMap = LinkedHashMap<String, Peer>() // keyed by fingerprint
    private val lock = Any()

    private var socket: MulticastSocket? = null
    private val jobs = mutableListOf<Job>()

    /** Begin announcing, listening, and pruning. */
    fun start() {
        val group = InetAddress.getByName(WrapDriveProtocol.MULTICAST_GROUP)
        val mcast = MulticastSocket(WrapDriveProtocol.DEFAULT_PORT)
        mcast.reuseAddress = true
        runCatching { mcast.joinGroup(group) }
        socket = mcast

        jobs +=
            scope.launch(Dispatchers.IO) { announceLoop(group) }
        jobs +=
            scope.launch(Dispatchers.IO) { listenLoop() }
        jobs +=
            scope.launch(Dispatchers.Default) { pruneLoop() }
    }

    /** Stop all loops and leave the multicast group. */
    suspend fun stop() {
        jobs.forEach { it.cancelAndJoin() }
        jobs.clear()
        runCatching { socket?.close() }
        socket = null
    }

    /** Record or refresh a peer learned via announcement or `/register`. */
    fun onRegister(info: DeviceInfo, capabilities: Capabilities, address: String) {
        if (info.fingerprint == self.fingerprint) return // exclude self
        synchronized(lock) {
            peerMap[info.fingerprint] =
                Peer(info, capabilities, address, System.currentTimeMillis())
            publish()
        }
    }

    private suspend fun announceLoop(group: InetAddress) {
        val payload = AnnouncementCodec.encode(self, capabilities).toByteArray(Charsets.UTF_8)
        while (kotlinx.coroutines.currentCoroutineContext().isActive) {
            runCatching {
                val packet =
                    DatagramPacket(payload, payload.size, group, WrapDriveProtocol.DEFAULT_PORT)
                socket?.send(packet)
            }
            delay(ANNOUNCE_INTERVAL_MS)
        }
    }

    private suspend fun listenLoop() {
        val buffer = ByteArray(8192)
        while (kotlinx.coroutines.currentCoroutineContext().isActive) {
            val packet = DatagramPacket(buffer, buffer.size)
            val received = runCatching { socket?.receive(packet); packet }.getOrNull() ?: continue
            val json = String(received.data, 0, received.length, Charsets.UTF_8)
            val announcement = runCatching { AnnouncementCodec.decode(json) }.getOrNull() ?: continue
            if (announcement.info.fingerprint == self.fingerprint) continue
            val address = received.address.hostAddress ?: continue
            onRegister(announcement.info, announcement.capabilities, address)
            // Trigger a two-way register so the other side learns about us too.
            runCatching { onAnnouncementPeer(address) }
        }
    }

    private suspend fun pruneLoop() {
        while (kotlinx.coroutines.currentCoroutineContext().isActive) {
            delay(PRUNE_INTERVAL_MS)
            val now = System.currentTimeMillis()
            synchronized(lock) {
                val stale = peerMap.filterValues { now - it.lastSeen > PEER_TTL_MS }.keys
                if (stale.isNotEmpty()) {
                    stale.forEach { peerMap.remove(it) }
                    publish()
                }
            }
        }
    }

    private fun publish() {
        _peers.value = peerMap.values.sortedBy { it.info.alias }
    }
}
