// Networking helpers for local dev. `selectLanIp` picks the host's primary LAN IPv4 from the shape
// `os.networkInterfaces()` returns, so a dev recipe can point phones at the machine without a
// hardcoded address. Kept pure (takes the interfaces map) so it is unit-testable off a sample.

import { networkInterfaces } from 'node:os';

/** The subset of `os.NetworkInterfaceInfo` we read; `internal` and IPv4 gate the choice. */
interface Iface {
  address: string;
  family: string | number;
  internal: boolean;
}

function isPrivateV4(address: string): boolean {
  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

/**
 * Choose the primary non-internal IPv4 from an `os.networkInterfaces()` map, or `undefined` when
 * the host has none (e.g. loopback only). Prefers a private-range address (192.168/10/172.16-31)
 * when several are present, so a VPN or public interface does not win over the real LAN.
 */
export function selectLanIp(interfaces: NodeJS.Dict<Iface[]> = {}): string | undefined {
  const candidates: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const iface of list ?? []) {
      // Node reports family as 'IPv4' (string) on older releases and 4 (number) on newer ones.
      const isV4 = iface.family === 'IPv4' || iface.family === 4;
      if (isV4 && !iface.internal) candidates.push(iface.address);
    }
  }
  return candidates.find(isPrivateV4) ?? candidates[0];
}

/** The live host's LAN IPv4, or `undefined` if it has none. Thin wrapper over {@link selectLanIp}. */
export function lanIp(): string | undefined {
  return selectLanIp(networkInterfaces() as NodeJS.Dict<Iface[]>);
}
