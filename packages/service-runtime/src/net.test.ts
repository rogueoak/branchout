import { describe, expect, it } from 'vitest';
import { selectLanIp } from './net';

describe('selectLanIp', () => {
  it('returns undefined for a loopback-only host', () => {
    expect(
      selectLanIp({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      }),
    ).toBeUndefined();
    expect(selectLanIp({})).toBeUndefined();
  });

  it('picks the single non-internal IPv4', () => {
    expect(
      selectLanIp({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        en0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
      }),
    ).toBe('192.168.1.42');
  });

  it('prefers a private-range address over a public/VPN one', () => {
    expect(
      selectLanIp({
        // A VPN interface's public-ish address comes first but must not win.
        utun0: [{ address: '100.64.3.9', family: 'IPv4', internal: false }],
        en0: [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
      }),
    ).toBe('10.0.0.7');
  });

  it('accepts the numeric family (4) newer Node reports', () => {
    expect(
      selectLanIp({
        en0: [{ address: '192.168.0.5', family: 4, internal: false }],
      }),
    ).toBe('192.168.0.5');
  });

  it('ignores IPv6 addresses', () => {
    expect(
      selectLanIp({
        en0: [
          { address: 'fe80::1', family: 'IPv6', internal: false },
          { address: '172.16.5.5', family: 'IPv4', internal: false },
        ],
      }),
    ).toBe('172.16.5.5');
  });

  it('returns undefined for an IPv6-only host (no reachable IPv4 to hand a phone)', () => {
    expect(
      selectLanIp({
        lo0: [{ address: '::1', family: 'IPv6', internal: true }],
        en0: [{ address: 'fe80::abcd', family: 'IPv6', internal: false }],
      }),
    ).toBeUndefined();
  });

  it('prefers the real LAN over a Docker bridge in the 172.16-31 block', () => {
    expect(
      selectLanIp({
        // Docker's default bridge (172.17.x) enumerates first on a Linux host but is unreachable
        // from a phone; the Wi-Fi/Ethernet 192.168 address must win.
        docker0: [{ address: '172.17.0.1', family: 4, internal: false }],
        wlan0: [{ address: '192.168.1.50', family: 4, internal: false }],
      }),
    ).toBe('192.168.1.50');
  });
});
