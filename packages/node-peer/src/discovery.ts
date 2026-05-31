/**
 * UDP multicast discovery for a Node peer.
 *
 * Announces this device to the multicast group on start and every 5s, listens
 * for other devices' announcements (excluding self by fingerprint), and prunes
 * peers unseen for 30s. The HTTP `/register` exchange updates the same peer
 * list via {@link recordPeer}.
 */

import dgram from 'node:dgram';
import {
  DEFAULT_PORT,
  MULTICAST_GROUP,
  serializeCapabilities,
  serializeDeviceInfo,
  parseCapabilities,
  parseDeviceInfo,
  type Capabilities,
  type DeviceInfo,
} from '@wrapdrive/protocol';
import { pickLanAddress } from './net-interface.js';

/** A discovered peer with its resolved address and last-seen time. */
export interface NodePeer {
  info: DeviceInfo;
  capabilities: Capabilities;
  address: string;
  lastSeen: number;
}

const ANNOUNCE_INTERVAL_MS = 5_000;
const PEER_TTL_MS = 30_000;
const PRUNE_INTERVAL_MS = 5_000;

type PeersListener = (peers: NodePeer[]) => void;

/** Encode/decode the announcement payload (device info + capabilities). */
function encodeAnnouncement(info: DeviceInfo, capabilities: Capabilities): string {
  const infoObj = JSON.parse(serializeDeviceInfo(info));
  infoObj.capabilities = JSON.parse(serializeCapabilities(capabilities));
  infoObj.announce = true;
  return JSON.stringify(infoObj);
}

function decodeAnnouncement(payload: string): { info: DeviceInfo; capabilities: Capabilities } {
  const obj = JSON.parse(payload);
  const info = parseDeviceInfo(JSON.stringify(obj));
  const capabilities = parseCapabilities(JSON.stringify(obj.capabilities));
  return { info, capabilities };
}

/** Multicast discovery service for a Node peer. */
export class Discovery {
  private socket: dgram.Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private readonly peers = new Map<string, NodePeer>();
  private readonly listeners = new Set<PeersListener>();

  constructor(
    private readonly self: DeviceInfo,
    private readonly capabilities: Capabilities,
    private readonly onPeerAnnounced?: (address: string) => void,
  ) {}

  start(): void {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    const lan = pickLanAddress();

    socket.on('message', (msg, rinfo) => {
      try {
        const { info, capabilities } = decodeAnnouncement(msg.toString('utf8'));
        if (info.fingerprint === this.self.fingerprint) return; // exclude self
        this.recordPeer(info, capabilities, rinfo.address);
        this.onPeerAnnounced?.(rinfo.address);
      } catch {
        // Ignore malformed datagrams.
      }
    });

    socket.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[wrapdrive] discovery socket error: ${err.message}`);
    });

    // Bind on all interfaces so we receive from any, but pin multicast
    // membership and outgoing multicast to the real LAN interface — critical on
    // machines with Hyper-V/VPN virtual adapters.
    socket.bind(DEFAULT_PORT, () => {
      try {
        if (lan) {
          socket.addMembership(MULTICAST_GROUP, lan.address);
          socket.setMulticastInterface(lan.address);
        } else {
          socket.addMembership(MULTICAST_GROUP);
        }
        socket.setMulticastTTL(4);
        socket.setMulticastLoopback(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[wrapdrive] multicast setup failed: ${String(err)}`);
      }
      this.announce();
      this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
    });

    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.socket?.close();
    this.socket = null;
  }

  /** Send a multicast announcement now. */
  announce(): void {
    const payload = Buffer.from(encodeAnnouncement(this.self, this.capabilities), 'utf8');
    this.socket?.send(payload, DEFAULT_PORT, MULTICAST_GROUP);
  }

  /** Record or refresh a peer learned via announcement or `/register`. */
  recordPeer(info: DeviceInfo, capabilities: Capabilities, address: string): void {
    if (info.fingerprint === this.self.fingerprint) return;
    this.peers.set(info.fingerprint, { info, capabilities, address, lastSeen: Date.now() });
    this.publish();
  }

  getPeers(): NodePeer[] {
    return [...this.peers.values()].sort((a, b) => a.info.alias.localeCompare(b.info.alias));
  }

  onPeersChanged(listener: PeersListener): () => void {
    this.listeners.add(listener);
    listener(this.getPeers());
    return () => this.listeners.delete(listener);
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;
    for (const [fp, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(fp);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  private publish(): void {
    const snapshot = this.getPeers();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export { encodeAnnouncement, decodeAnnouncement };
