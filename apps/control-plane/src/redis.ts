import { createClient, type RedisClientType } from 'redis';

export function createRedisClient(url: string): RedisClientType {
  return createClient({ url });
}

/** True if the client answers PING. Never throws; a down cache returns false. */
export async function pingRedis(client: RedisClientType): Promise<boolean> {
  try {
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}
