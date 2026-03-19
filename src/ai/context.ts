import type { Message, TextChannel, ThreadChannel } from 'discord.js';
import { AI_HELPER_CONFIG } from './config';
import { aiLogger } from './openai-client';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  authorName: string;
  content: string;
}

export async function fetchConversationContext(
  message: Message,
  botId: string,
): Promise<string> {
  if (!AI_HELPER_CONFIG.contextEnabled || AI_HELPER_CONFIG.contextMessages <= 0) {
    return '';
  }

  try {
    const channel = message.channel as TextChannel | ThreadChannel;
    const messages = await channel.messages.fetch({
      limit: AI_HELPER_CONFIG.contextMessages,
      before: message.id,
    });

    if (messages.size === 0) {
      return '';
    }

    const contextMessages: ConversationMessage[] = [];

    // Messages come newest-first, reverse to chronological order
    const sorted = [...messages.values()].reverse();

    for (const msg of sorted) {
      // Skip system messages and embeds-only messages
      if (!msg.content || msg.content.trim().length === 0) continue;

      // Skip bot commands (messages starting with /)
      if (msg.content.startsWith('/')) continue;

      const role = msg.author.id === botId ? 'assistant' : 'user';
      const authorName = msg.author.id === botId ? 'Bot' : msg.member?.displayName || msg.author.username;

      // Truncate long messages in context
      const content = msg.content.length > 300
        ? msg.content.slice(0, 300) + '...'
        : msg.content;

      contextMessages.push({ role, authorName, content });
    }

    if (contextMessages.length === 0) {
      return '';
    }

    const lines = contextMessages.map((m) =>
      m.role === 'assistant' ? `Bot: ${m.content}` : `${m.authorName}: ${m.content}`
    );

    return `[Recent conversation]\n${lines.join('\n')}\n---\n[Current question]\n`;
  } catch (error) {
    aiLogger.warn({ err: error }, 'Failed to fetch conversation context');
    return '';
  }
}
