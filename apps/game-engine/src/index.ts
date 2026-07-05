import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createRedisClient, pingRedis } from './redis';
import { attachGameSocket } from './socket';

async function main(): Promise<void> {
  const config = loadConfig();
  const redis = createRedisClient(config.redisUrl);
  redis.on('error', (error) => console.error('[game-engine] redis error', error));
  await redis.connect();

  // Prove the wiring on boot so `docker compose up` surfaces a bad connection string early.
  const cache = await pingRedis(redis);
  console.log(`[game-engine] startup check redis=${cache ? 'ok' : 'unreachable'}`);

  const app = createApp({ checkRedis: () => pingRedis(redis) });
  const server = createServer(app);
  attachGameSocket(server);

  server.listen(config.port, () =>
    console.log(`[game-engine] listening on :${config.port} (http + ws)`),
  );
}

main().catch((error) => {
  console.error('[game-engine] failed to start', error);
  process.exitCode = 1;
});
