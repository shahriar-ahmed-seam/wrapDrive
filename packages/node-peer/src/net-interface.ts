/**
 * Local network interface selection.
 *
 * On machines with virtual adapters (Hyper-V, WSL, VPNs) multicast and the
 * advertised IP must be pinned to the real LAN interface, otherwise discovery
 * goes out a virtual switch and never reaches other devices. This picks the
 * best private IPv4 LAN address, preferring common home/office ranges and
 * de-prioritising known virtual-adapter ranges.
 */

import { networkInterfaces } from 'node:os';

/** A usable LAN interface address. */
export interface LanAddress {
  /** The IPv4 address to advertise and bind multicast to. */
  address: string;
  /** The OS interface name. */
  name: string;
}

// Hyper-V "Default Switch" and similar virtual adapters commonly use
// 172.16–172.31 with a .1 host; rank these last.
function score(name: string, address: string): number {
  const lower = name.toLowerCase();
  let s = 0;
  if (address.startsWith('192.168.')) s += 100;
  else if (address.startsWith('10.')) s += 80;
  else if (address.startsWith('172.')) s += 20;
  if (/wi-?fi|wlan|wireless/.test(lower)) s += 30;
  if (/ethernet|eth/.test(lower)) s += 20;
  if (/hyper-?v|vethernet|virtual|vmware|vbox|wsl|loopback|docker/.test(lower)) s -= 80;
  if (address.endsWith('.1')) s -= 10; // gateways/virtual switches often use .1
  return s;
}

/** Pick the most likely real LAN IPv4 address, or null if none found. */
export function pickLanAddress(): LanAddress | null {
  const candidates: Array<LanAddress & { score: number }> = [];
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push({ address: addr.address, name, score: score(name, addr.address) });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return { address: best.address, name: best.name };
}
