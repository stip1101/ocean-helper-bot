import { randomBytes } from 'crypto';
import { redis } from '../state';
import { aiLogger } from './openai-client';

function generateId(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

const TEMP_INFO_KEY = 'aihelper:temp-info';
const MAX_TEMP_INFO_ENTRIES = 10;
const MAX_TEMP_INFO_LENGTH = 500;

export interface TempInfo {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
}

// Lua script for atomic check-and-add (prevents race condition)
// Uses redis.eval (ioredis Lua scripting) - NOT JavaScript eval()
const ADD_TEMP_INFO_SCRIPT = `
local count = redis.call('HLEN', KEYS[1])
local maxEntries = tonumber(ARGV[1])
if count >= maxEntries then
  return nil
end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
return ARGV[2]
`;

export async function addTempInfo(text: string, adminId: string): Promise<string | null> {
  try {
    const trimmedText = text.trim();

    if (trimmedText.length > MAX_TEMP_INFO_LENGTH) {
      throw new Error(`Text exceeds maximum length of ${MAX_TEMP_INFO_LENGTH} characters`);
    }

    const id = generateId();
    const entry: Omit<TempInfo, 'id'> = {
      text: trimmedText,
      createdBy: adminId,
      createdAt: new Date().toISOString(),
    };

    // Atomic check-and-add using Redis Lua scripting
    const result = await redis.eval(
      ADD_TEMP_INFO_SCRIPT,
      1,
      TEMP_INFO_KEY,
      MAX_TEMP_INFO_ENTRIES.toString(),
      id,
      JSON.stringify(entry)
    );

    if (result === null) {
      return null;
    }

    aiLogger.info({ id, adminId, textLength: trimmedText.length }, 'Temp info added');
    return id;
  } catch (error) {
    aiLogger.error({ err: error, adminId }, 'Failed to add temp info');
    throw error;
  }
}

export async function removeTempInfo(id: string): Promise<boolean> {
  try {
    const deleted = await redis.hdel(TEMP_INFO_KEY, id);
    if (deleted > 0) {
      aiLogger.info({ id }, 'Temp info removed');
      return true;
    }
    return false;
  } catch (error) {
    aiLogger.error({ err: error, id }, 'Failed to remove temp info');
    throw error;
  }
}

export async function getTempInfo(id: string): Promise<TempInfo | null> {
  try {
    const data = await redis.hget(TEMP_INFO_KEY, id);
    if (!data) return null;

    const entry = JSON.parse(data) as Omit<TempInfo, 'id'>;
    return { id, ...entry };
  } catch (error) {
    aiLogger.error({ err: error, id }, 'Failed to get temp info');
    return null;
  }
}

export async function listTempInfo(): Promise<TempInfo[]> {
  try {
    const data = await redis.hgetall(TEMP_INFO_KEY);
    const entries: TempInfo[] = [];

    for (const [id, value] of Object.entries(data)) {
      try {
        const entry = JSON.parse(value) as Omit<TempInfo, 'id'>;
        entries.push({ id, ...entry });
      } catch {
        aiLogger.warn({ id }, 'Invalid temp info entry, skipping');
      }
    }

    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return entries;
  } catch (error) {
    aiLogger.error({ err: error }, 'Failed to list temp info');
    return [];
  }
}

export async function getTempInfoForPrompt(): Promise<string> {
  try {
    const entries = await listTempInfo();
    if (entries.length === 0) return '';

    const bulletPoints = entries.map((entry) => `• ${entry.text}`).join('\n');
    return bulletPoints;
  } catch (error) {
    aiLogger.error({ err: error }, 'Failed to get temp info for prompt');
    return '';
  }
}

export async function getTempInfoStats(): Promise<{ count: number; max: number }> {
  try {
    const count = await redis.hlen(TEMP_INFO_KEY);
    return { count, max: MAX_TEMP_INFO_ENTRIES };
  } catch (error) {
    aiLogger.error({ err: error }, 'Failed to get temp info stats');
    return { count: 0, max: MAX_TEMP_INFO_ENTRIES };
  }
}

export { MAX_TEMP_INFO_ENTRIES, MAX_TEMP_INFO_LENGTH };
