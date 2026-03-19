import { describe, it, expect, mock, beforeEach } from 'bun:test';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
};

mock.module('../../utils/logger', () => ({
  logger: silentLogger,
}));

mock.module('../openai-client', () => ({
  openai: null,
  aiLogger: silentLogger,
}));

// Store env backup
const originalContextEnabled = process.env.AI_HELPER_CONTEXT_ENABLED;
const originalContextMessages = process.env.AI_HELPER_CONTEXT_MESSAGES;

import { fetchConversationContext } from '../context';

function createMockChannel(messages: Array<{ id: string; content: string; authorId: string; username: string }>) {
  const collection = new Map(
    messages.map((msg) => [
      msg.id,
      {
        id: msg.id,
        content: msg.content,
        author: { id: msg.authorId, username: msg.username },
        member: { displayName: msg.username },
      },
    ])
  );

  return {
    messages: {
      fetch: async () => collection,
    },
  };
}

function createMockMessage(channelMessages: Array<{ id: string; content: string; authorId: string; username: string }>) {
  const channel = createMockChannel(channelMessages);
  return {
    id: 'current-msg-id',
    channel,
  } as any;
}

describe('Conversation Context', () => {
  beforeEach(() => {
    process.env.AI_HELPER_CONTEXT_ENABLED = 'true';
    process.env.AI_HELPER_CONTEXT_MESSAGES = '10';
  });

  it('should return empty string when no previous messages', async () => {
    const message = createMockMessage([]);
    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toBe('');
  });

  it('should format user messages with usernames', async () => {
    const message = createMockMessage([
      { id: '1', content: 'How do I run a job?', authorId: 'user1', username: 'Alice' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toContain('Alice: How do I run a job?');
    expect(result).toContain('[Recent conversation]');
    expect(result).toContain('[Current question]');
  });

  it('should format bot messages with "Bot:" prefix', async () => {
    const message = createMockMessage([
      { id: '1', content: 'Use the dashboard to run jobs.', authorId: 'bot-id', username: 'OnComputeBot' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toContain('Bot: Use the dashboard to run jobs.');
  });

  it('should skip empty messages', async () => {
    const message = createMockMessage([
      { id: '1', content: '', authorId: 'user1', username: 'Alice' },
      { id: '2', content: 'Real question here?', authorId: 'user2', username: 'Bob' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).not.toContain('Alice');
    expect(result).toContain('Bob: Real question here?');
  });

  it('should skip slash commands', async () => {
    const message = createMockMessage([
      { id: '1', content: '/aihelper status', authorId: 'user1', username: 'Alice' },
      { id: '2', content: 'What is the pricing?', authorId: 'user2', username: 'Bob' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).not.toContain('/aihelper');
    expect(result).toContain('Bob: What is the pricing?');
  });

  it('should truncate long messages in context', async () => {
    const longContent = 'x'.repeat(400);
    const message = createMockMessage([
      { id: '1', content: longContent, authorId: 'user1', username: 'Alice' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toContain('...');
    // Should not contain the full 400 chars
    expect(result.length).toBeLessThan(400);
  });

  it('should return empty when context is disabled', async () => {
    process.env.AI_HELPER_CONTEXT_ENABLED = 'false';
    const message = createMockMessage([
      { id: '1', content: 'Hello', authorId: 'user1', username: 'Alice' },
    ]);

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toBe('');

    // Restore
    process.env.AI_HELPER_CONTEXT_ENABLED = 'true';
  });

  it('should handle fetch errors gracefully', async () => {
    const message = {
      id: 'msg-id',
      channel: {
        messages: {
          fetch: async () => { throw new Error('Discord API error'); },
        },
      },
    } as any;

    const result = await fetchConversationContext(message, 'bot-id');
    expect(result).toBe('');
  });
});
