import OpenAI from 'openai';
import { logger } from '../utils/logger';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey && process.env.NODE_ENV === 'production') {
  throw new Error('OPENAI_API_KEY environment variable is required in production');
}

export const openai: OpenAI | null = apiKey ? new OpenAI({ apiKey }) : null;

if (!apiKey) {
  logger.warn('OPENAI_API_KEY not set - AI helper will not work');
}

export const aiLogger = logger.child({ module: 'ai' });
