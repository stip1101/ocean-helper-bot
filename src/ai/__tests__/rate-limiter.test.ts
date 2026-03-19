import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  createMockRedis,
  createMockRedisState,
  type MockRedisState,
} from './mocks/redis.mock';
import { generateValidUserId } from './mocks/discord.mock';

let redisState: MockRedisState;

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
};

mock.module('../../state', () => {
  redisState = createMockRedisState();
  return {
    redis: createMockRedis(redisState),
  };
});

mock.module('../../utils/logger', () => ({
  logger: silentLogger,
}));

mock.module('../openai-client', () => ({
  openai: null,
  aiLogger: silentLogger,
}));

import {
  acquireRateLimitSlot,
  isAiHelperDisabled,
  disableAiHelper,
  enableAiHelper,
  resetUserRateLimit,
  getRateLimitStatus,
} from '../rate-limiter';

describe('Rate Limiter', () => {
  beforeEach(() => {
    redisState.data.clear();
    redisState.ttls.clear();
    redisState.evalResult = null;
    redisState.shouldThrow = false;
  });

  describe('validateUserId', () => {
    it('should accept valid 17-19 digit user IDs', async () => {
      for (const len of [17, 18, 19] as const) {
        const userId = generateValidUserId(len);
        const result = await acquireRateLimitSlot(userId);
        expect(result.allowed).toBe(true);
      }
    });

    it('should reject invalid user IDs', () => {
      expect(() => acquireRateLimitSlot('1234567890123456')).toThrow('Invalid user ID format');
      expect(() => acquireRateLimitSlot('12345678901234567890')).toThrow('Invalid user ID format');
      expect(() => acquireRateLimitSlot('abc12345678901234')).toThrow('Invalid user ID format');
      expect(() => acquireRateLimitSlot('')).toThrow('Invalid user ID format');
    });
  });

  describe('acquireRateLimitSlot', () => {
    const validUserId = '123456789012345678';

    it('should allow request when under rate limit', async () => {
      redisState.evalResult = [1, 'ok', 9];
      const result = await acquireRateLimitSlot(validUserId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should reject when disabled', async () => {
      redisState.evalResult = [0, 'disabled', 0];
      const result = await acquireRateLimitSlot(validUserId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('should reject when in cooldown', async () => {
      redisState.evalResult = [0, 'cooldown', 5];
      const result = await acquireRateLimitSlot(validUserId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('cooldown');
      expect(result.resetInSeconds).toBe(5);
    });

    it('should reject when rate limit exceeded', async () => {
      redisState.evalResult = [0, 'rate_limit', 30];
      const result = await acquireRateLimitSlot(validUserId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('rate_limit');
      expect(result.remaining).toBe(0);
    });

    it('should allow on Redis error (graceful degradation)', async () => {
      redisState.shouldThrow = true;
      const result = await acquireRateLimitSlot(validUserId);
      expect(result.allowed).toBe(true);
    });
  });

  describe('isAiHelperDisabled', () => {
    it('should return true when disabled', async () => {
      redisState.data.set('ai_helper:disabled', '1');
      expect(await isAiHelperDisabled()).toBe(true);
    });

    it('should return false when not disabled', async () => {
      expect(await isAiHelperDisabled()).toBe(false);
    });

    it('should return false on Redis error', async () => {
      redisState.shouldThrow = true;
      expect(await isAiHelperDisabled()).toBe(false);
    });
  });

  describe('enable/disable', () => {
    it('should set disabled key', async () => {
      await disableAiHelper();
      expect(redisState.data.get('ai_helper:disabled')).toBe('1');
    });

    it('should delete disabled key', async () => {
      redisState.data.set('ai_helper:disabled', '1');
      await enableAiHelper();
      expect(redisState.data.has('ai_helper:disabled')).toBe(false);
    });
  });

  describe('resetUserRateLimit', () => {
    const validUserId = '123456789012345678';

    it('should delete rate and cooldown keys', async () => {
      redisState.data.set(`ai_helper:rate:${validUserId}`, '5');
      redisState.data.set(`ai_helper:cooldown:${validUserId}`, '1');
      await resetUserRateLimit(validUserId);
      expect(redisState.data.has(`ai_helper:rate:${validUserId}`)).toBe(false);
      expect(redisState.data.has(`ai_helper:cooldown:${validUserId}`)).toBe(false);
    });
  });

  describe('getRateLimitStatus', () => {
    const validUserId = '123456789012345678';

    it('should return correct status with no usage', async () => {
      const status = await getRateLimitStatus(validUserId);
      expect(status.requestsUsed).toBe(0);
      expect(status.requestsLimit).toBe(10);
      expect(status.cooldownActive).toBe(false);
    });

    it('should return correct status with usage', async () => {
      redisState.data.set(`ai_helper:rate:${validUserId}`, '3');
      redisState.ttls.set(`ai_helper:rate:${validUserId}`, 45);
      const status = await getRateLimitStatus(validUserId);
      expect(status.requestsUsed).toBe(3);
      expect(status.resetInSeconds).toBe(45);
    });

    it('should handle Redis error gracefully', async () => {
      redisState.shouldThrow = true;
      const status = await getRateLimitStatus(validUserId);
      expect(status.requestsUsed).toBe(0);
    });
  });
});
