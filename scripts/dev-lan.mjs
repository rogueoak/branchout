// `pnpm dev:lan` - run the local dev stack reachable from other devices on the same WiFi (spec
// 0024), so you can play Liar Liar on real phones against a shared viewer screen. It detects the
// host's LAN IP, points the browser's NEXT_PUBLIC_* URLs and the control-plane CORS origin at it
// (via LAN_HOST, consumed by infra/docker-compose.override.yml), prints the URL to open on phones,
// and brings up the compose dev stack. Production is unchanged (same-origin behind Caddy).
//
// Build first (`pnpm build`) so the workspace packages this script imports are present.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let lanIp;
try {
  ({ lanIp } = await import('@branchout/service-runtime'));
} catch {
  console.error('[dev:lan] @branchout/service-runtime is not built - run `pnpm build` first.');
  process.exit(1);
}

const ip = lanIp();
if (!ip) {
  console.warn(
    '[dev:lan] No LAN IPv4 found; falling back to localhost. Other devices will NOT be able to connect.',
  );
}
const host = ip ?? 'localhost';
const webPort = process.env.WEB_PORT ?? '3000';
const cpPort = process.env.CONTROL_PLANE_PORT ?? '4000';
const enginePort = process.env.GAME_ENGINE_PORT ?? '4001';

console.log('');
console.log('  Branch out - LAN dev');
console.log('  --------------------');
console.log(`  Open on phones:  http://${host}:${webPort}`);
console.log(`  API:             http://${host}:${cpPort}`);
console.log(`  Engine WS:       ws://${host}:${enginePort}`);
console.log('  (every device must be on the same WiFi)');
console.log('');

const infra = path.resolve(fileURLToPath(new URL('../infra', import.meta.url)));
const child = spawn('docker', ['compose', 'up'], {
  cwd: infra,
  stdio: 'inherit',
  env: { ...process.env, LAN_HOST: host },
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error('[dev:lan] failed to start docker compose:', error.message);
  process.exit(1);
});
