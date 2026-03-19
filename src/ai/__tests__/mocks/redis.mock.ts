export interface MockRedisState {
  data: Map<string, string>;
  ttls: Map<string, number>;
  evalResult: [number, string, number] | null;
  shouldThrow: boolean;
}

export function createMockRedisState(): MockRedisState {
  return {
    data: new Map(),
    ttls: new Map(),
    evalResult: null,
    shouldThrow: false,
  };
}

export function createMockRedis(state: MockRedisState) {
  return {
    get: async (key: string): Promise<string | null> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      return state.data.get(key) ?? null;
    },

    set: async (key: string, value: string, ...args: string[]): Promise<string | null> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      // Handle SET with NX flag
      if (args.includes('NX') && state.data.has(key)) {
        return null;
      }
      state.data.set(key, value);
      // Handle EX flag
      const exIndex = args.indexOf('EX');
      if (exIndex !== -1 && args[exIndex + 1]) {
        state.ttls.set(key, parseInt(args[exIndex + 1]!, 10));
      }
      return 'OK';
    },

    setex: async (key: string, seconds: number, value: string): Promise<'OK'> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      state.data.set(key, value);
      state.ttls.set(key, seconds);
      return 'OK';
    },

    del: async (...keys: string[]): Promise<number> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      let deleted = 0;
      for (const key of keys) {
        if (state.data.has(key)) {
          state.data.delete(key);
          state.ttls.delete(key);
          deleted++;
        }
      }
      return deleted;
    },

    ttl: async (key: string): Promise<number> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      if (!state.data.has(key)) return -2;
      return state.ttls.get(key) ?? -1;
    },

    eval: async (
      _script: string,
      _numKeys: number,
      ..._args: string[]
    ): Promise<[number, string, number]> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      if (state.evalResult) {
        return state.evalResult;
      }
      return [1, 'ok', 9];
    },

    hset: async (key: string, field: string, value: string): Promise<number> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      state.data.set(`${key}:${field}`, value);
      return 1;
    },

    hget: async (key: string, field: string): Promise<string | null> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      return state.data.get(`${key}:${field}`) ?? null;
    },

    hdel: async (key: string, field: string): Promise<number> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      const fullKey = `${key}:${field}`;
      if (state.data.has(fullKey)) {
        state.data.delete(fullKey);
        return 1;
      }
      return 0;
    },

    hgetall: async (key: string): Promise<Record<string, string>> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      const result: Record<string, string> = {};
      const prefix = `${key}:`;
      for (const [k, v] of state.data) {
        if (k.startsWith(prefix)) {
          result[k.slice(prefix.length)] = v;
        }
      }
      return result;
    },

    hlen: async (key: string): Promise<number> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      let count = 0;
      const prefix = `${key}:`;
      for (const k of state.data.keys()) {
        if (k.startsWith(prefix)) count++;
      }
      return count;
    },

    ping: async (): Promise<'PONG'> => {
      if (state.shouldThrow) throw new Error('Redis connection error');
      return 'PONG';
    },

    quit: async (): Promise<'OK'> => {
      return 'OK';
    },

    on: () => {},
  };
}

export type MockRedis = ReturnType<typeof createMockRedis>;
