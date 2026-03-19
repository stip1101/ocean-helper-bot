import { Events, type Message, ChannelType } from 'discord.js';
import type { ExtendedClient } from '../client';
import { AI_HELPER_CONFIG, shouldRespond, processMessage, formatResponse, aiLogger } from '../../ai';
import { redis } from '../../state';

export function setupMessageCreateEvent(client: ExtendedClient): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    // Only respond in the configured channel (if set)
    const channelId = AI_HELPER_CONFIG.channelId;
    if (channelId && message.channel.id !== channelId) return;

    if (!AI_HELPER_CONFIG.enabled) return;

    const botId = client.user?.id;
    if (!botId) return;

    const isMentioned = message.mentions.has(botId);
    const shouldAutoRespond = shouldRespond(message, botId);

    if (!isMentioned && !shouldAutoRespond) return;

    // Deduplicate: prevent processing the same message twice
    const dedupKey = `ai:msg:${message.id}`;
    const isNew = await redis.set(dedupKey, '1', 'EX', 10, 'NX');
    if (!isNew) return;

    try {
      if (message.channel.type === ChannelType.GuildText) {
        await message.channel.sendTyping();
      }

      const result = await processMessage(message, botId);

      if (result.success && result.message) {
        const formattedResponse = formatResponse(result.message, result.rateLimitInfo?.remaining);
        await message.reply({
          content: formattedResponse,
          allowedMentions: { repliedUser: true },
        });
      } else if (result.error) {
        if (isMentioned) {
          await message.reply({
            content: result.error,
            allowedMentions: { repliedUser: true },
          });
        }
      }
    } catch (error) {
      aiLogger.error({ err: error, messageId: message.id }, 'Error handling message');

      if (isMentioned) {
        try {
          await message.reply({
            content: '❌ An error occurred while processing your request. Please try again later.',
            allowedMentions: { repliedUser: true },
          });
        } catch {
          // Failed to send error message
        }
      }
    }
  });
}
