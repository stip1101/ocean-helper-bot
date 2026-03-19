import { redis } from '../state';
import { AI_HELPER_CONFIG } from './config';
import { aiLogger } from './openai-client';

const RATE_KEY_PREFIX = 'ai_helper:rate:';
const COOLDOWN_KEY_PREFIX = 'ai_helper:cooldown:';
const DISABLED_KEY = 'ai_helper:disabled';

const DISCORD_ID_REGEX = /^\d{17,19}$/;

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'rate_limit' | 'cooldown' | 'disabled';
  remaining?: number;
  resetInSeconds?: number;
}

function validateUserId(userId: string): void {
  if (!DISCORD_ID_REGEX.test(userId)) {
    throw new Error('Invalid user ID format');
  }
}

const ACQUIRE_SLOT_SCRIPT = `
local disabled = redis.call('GET', KEYS[1])
if disabled == '1' then
  return {0, 'disabled', 0}
end

local cooldown = redis.call('TTL', KEYS[2])
if cooldown > 0 then
  return {0, 'cooldown', cooldown}
end

local count = tonumber(redis.call('GET', KEYS[3]) or '0')
local maxRequests = tonumber(ARGV[1])

if count >= maxRequests then
  local ttl = redis.call('TTL', KEYS[3])
  if ttl < 0 then ttl = tonumber(ARGV[2]) end
  return {0, 'rate_limit', ttl}
end

redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], ARGV[2], 'NX')
redis.call('SETEX', KEYS[2], ARGV[3], '1')

return {1, 'ok', maxRequests - count - 1}
`;

export async function isAiHelperDisabled(): Promise<boolean> {
  try {
    const disabled = await redis.get(DISABLED_KEY);
    return disabled === '1';
  } catch (error) {
    aiLogger.error({ err: error }, 'Redis error checking disabled status');
    return false;
  }
}

export async function disableAiHelper(): Promise<void> {
  await redis.set(DISABLED_KEY, '1');
  aiLogger.info('AI helper disabled globally');
}

export async function enableAiHelper(): Promise<void> {
  await redis.del(DISABLED_KEY);
  aiLogger.info('AI helper enabled globally');
}

// Uses Redis Lua scripting (redis.eval) for atomic rate limit operations
// This is NOT JavaScript eval() - it's the standard ioredis method for Lua scripts
export async function acquireRateLimitSlot(userId: string): Promise<RateLimitResult> {
  validateUserId(userId);

  const disabledKey = DISABLED_KEY;
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}`;
  const rateKey = `${RATE_KEY_PREFIX}${userId}`;

  try {
    const result = await redis.eval(
      ACQUIRE_SLOT_SCRIPT,
      3,
      disabledKey,
      cooldownKey,
      rateKey,
      AI_HELPER_CONFIG.rateLimitRequests.toString(),
      AI_HELPER_CONFIG.rateLimitWindowSeconds.toString(),
      AI_HELPER_CONFIG.cooldownSeconds.toString()
    ) as [number, string, number];

    const [allowed, reason, value] = result;

    if (allowed === 1) {
      return {
        allowed: true,
        remaining: value,
      };
    }

    return {
      allowed: false,
      reason: reason as RateLimitResult['reason'],
      remaining: reason === 'rate_limit' ? 0 : undefined,
      resetInSeconds: value > 0 ? value : undefined,
    };
  } catch (error) {
    aiLogger.error({ err: error, userId }, 'Redis error in rate limiter');
    return { allowed: true, remaining: 0 };
  }
}

export async function resetUserRateLimit(userId: string): Promise<void> {
  validateUserId(userId);

  const rateKey = `${RATE_KEY_PREFIX}${userId}`;
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}`;

  await redis.del(rateKey, cooldownKey);
  aiLogger.info({ userId }, 'User rate limit reset');
}

export async function getRateLimitStatus(userId: string): Promise<{
  requestsUsed: number;
  requestsLimit: number;
  cooldownActive: boolean;
  resetInSeconds: number;
}> {
  validateUserId(userId);

  const rateKey = `${RATE_KEY_PREFIX}${userId}`;
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${userId}`;

  try {
    const [countStr, rateTtl, cooldownTtl] = await Promise.all([
      redis.get(rateKey),
      redis.ttl(rateKey),
      redis.ttl(cooldownKey),
    ]);

    return {
      requestsUsed: countStr ? parseInt(countStr, 10) : 0,
      requestsLimit: AI_HELPER_CONFIG.rateLimitRequests,
      cooldownActive: cooldownTtl > 0,
      resetInSeconds: rateTtl > 0 ? rateTtl : 0,
    };
  } catch (error) {
    aiLogger.error({ err: error, userId }, 'Redis error in getRateLimitStatus');
    return {
      requestsUsed: 0,
      requestsLimit: AI_HELPER_CONFIG.rateLimitRequests,
      cooldownActive: false,
      resetInSeconds: 0,
    };
  }
}
