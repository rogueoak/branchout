import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The e2e package sits at the repo root, so one level up from this file's dir (e2e/lib) is e2e/,
// and two up is the repo root that holds infra/.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const infra = join(repoRoot, 'infra');

// Host ports for the e2e stack. Deliberately NOT the dev defaults (3000/4000/4001) so a Playwright
// run can coexist with a developer's running `docker compose up` dev stack. The browser reaches the
// apps on these ports; the dev overlay derives NEXT_PUBLIC_* from CONTROL_PLANE_PORT/
// GAME_ENGINE_PORT, so shifting them here keeps the browser pointed at the right services.
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const CONTROL_PLANE_PORT = Number(process.env.E2E_CONTROL_PLANE_PORT ?? 4100);
const GAME_ENGINE_PORT = Number(process.env.E2E_GAME_ENGINE_PORT ?? 4101);
export const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT ?? 3102);

export const BASE_URL = `http://localhost:${WEB_PORT}`;
/** The admin console (spec 0037) is its own service on a shifted port. */
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;

// Docker binary is `docker` on PATH by default; override with DOCKER_BIN for a non-standard install
// (e.g. a Colima setup where the CLI is not symlinked).
const DOCKER = process.env.DOCKER_BIN ?? 'docker';

// A distinct project name isolates this stack's containers/networks/volumes/images from the dev
// stack, so `up` and `down -v` never touch a developer's running environment.
const PROJECT = 'branchout-e2e';

// Variables the compose files interpolate. Postgres/Redis are reached over the compose network by
// service name (never the host), so they need no published host ports (see docker-compose.e2e.yml).
const composeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: PROJECT,
  POSTGRES_USER: 'branchout',
  POSTGRES_PASSWORD: 'branchout',
  POSTGRES_DB: 'branchout',
  DATABASE_URL: 'postgres://branchout:branchout@postgres:5432/branchout',
  REDIS_URL: 'redis://redis:6379',
  WEB_PORT: String(WEB_PORT),
  CONTROL_PLANE_PORT: String(CONTROL_PLANE_PORT),
  GAME_ENGINE_PORT: String(GAME_ENGINE_PORT),
  ADMIN_PORT: String(ADMIN_PORT),
};

// Base (production-shaped) + dev overlay (browser -> localhost, runtime NEXT_PUBLIC_*, SSR
// CONTROL_PLANE_URL) + e2e overlay (drop pg/redis host ports for isolation).
function composeFiles(): string[] {
  return [
    '-f',
    join(infra, 'docker-compose.yml'),
    '-f',
    join(infra, 'docker-compose.override.yml'),
    '-f',
    join(infra, 'docker-compose.e2e.yml'),
  ];
}

function compose(args: string[], opts: { quiet?: boolean } = {}): void {
  execFileSync(DOCKER, ['compose', ...composeFiles(), ...args], {
    cwd: repoRoot,
    env: composeEnv,
    stdio: opts.quiet ? 'ignore' : 'inherit',
  });
}

/** Bring the full stack up and block until every service reports healthy (`--wait`). */
export function upStack(): void {
  // `--build` so the images reflect the current working tree; `--wait` blocks on the compose
  // healthchecks (each service polls its own /health), so no test starts against a half-up stack.
  compose(['up', '--build', '--wait', '-d']);
}

/** Tear the stack down, removing volumes so the next run starts from a clean database. */
export function downStack(): void {
  try {
    compose(['down', '-v', '--remove-orphans'], { quiet: true });
  } catch {
    // Teardown is best-effort: a failure here should not mask a test result.
  }
}

/**
 * Grant the insider role to an account by gamer tag, via an UPDATE against the e2e Postgres
 * container. This is the documented out-of-band grant (spec 0035) - the e2e stand-in for a manual DB
 * update, until the admin console (spec 0037) ships a toggle. The tag is asserted alphanumeric (the
 * uniqueAccount helper's shape) before it reaches the SQL, so the inline value is never attacker
 * controlled.
 */
export function grantInsider(gamerTag: string): void {
  if (!/^[A-Za-z0-9]+$/.test(gamerTag)) {
    throw new Error(`grantInsider: unexpected gamer tag ${JSON.stringify(gamerTag)}`);
  }
  const out = execFileSync(
    DOCKER,
    [
      'compose',
      ...composeFiles(),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'branchout',
      '-d',
      'branchout',
      '-c',
      `UPDATE accounts SET insider = true WHERE gamer_tag = '${gamerTag}';`,
    ],
    { cwd: repoRoot, env: composeEnv, encoding: 'utf8' },
  );
  // psql prints "UPDATE <n>"; a 0-row update means the tag never landed, so fail loudly here rather
  // than as a confusing gate failure later.
  if (!/UPDATE\s+[1-9]/.test(out)) {
    throw new Error(
      `grantInsider: no account updated for gamer tag ${gamerTag} (got: ${out.trim()})`,
    );
  }
}

/** Poll the web app's /health until it answers ok, as a final gate after `up --wait`. */
export async function waitForWeb(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
      lastErr = new Error(`/health -> ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`web app never became healthy at ${BASE_URL}: ${String(lastErr)}`);
}
