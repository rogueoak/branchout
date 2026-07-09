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
});
