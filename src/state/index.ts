import Redis from 'ioredis';
import { stateLogger } from '../utils/logger';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl && process.env.NODE_ENV === 'production') {
  throw new Error('REDIS_URL environment variable is required in production');
}

const resolvedRedisUrl = redisUrl || 'redis://localhost:6379';

export const redis = new Redis(resolvedRedisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  stateLogger.info('Redis connected');
});

redis.on('error', (err) => {
  stateLogger.error({ err }, 'Redis error');
});
