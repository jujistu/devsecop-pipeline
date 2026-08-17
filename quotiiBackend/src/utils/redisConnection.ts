import type { ConnectionOptions } from 'bullmq';

/**
 * Resolve BullMQ Redis connection settings from the environment.
 *
 * Supports REDIS_URL (redis://host:6379) or REDIS_HOST + REDIS_PORT.
 * Defaults to localhost:6379 for local development.
 */
export function getRedisConnection(
  env: NodeJS.ProcessEnv = process.env
): ConnectionOptions {
  const url = env.REDIS_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const port = parsed.port ? Number(parsed.port) : 6379;
      return {
        host: parsed.hostname || 'localhost',
        port: Number.isFinite(port) ? port : 6379,
        ...(parsed.password ? { password: parsed.password } : {}),
        ...(parsed.username ? { username: parsed.username } : {}),
      };
    } catch {
      throw new Error(`Invalid REDIS_URL: ${url}`);
    }
  }

  const host = env.REDIS_HOST?.trim() || 'localhost';
  const port = Number(env.REDIS_PORT || 6379);
  return {
    host,
    port: Number.isFinite(port) ? port : 6379,
  };
}
