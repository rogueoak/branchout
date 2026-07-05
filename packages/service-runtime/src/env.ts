/**
 * Read a required environment variable. Throws if it is missing or empty so a service fails
 * fast on boot rather than silently pointing at a default.
 */
export function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`missing required environment variable: ${key}`);
  }
  return value;
}
