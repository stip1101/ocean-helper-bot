import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../client';
import { requireAdmin } from '../../../utils/guards';
import {
  isAiHelperDisabled,
  enableAiHelper,
  disableAiHelper,
  resetUserRateLimit,
  getRateLimitStatus,
  AI_HELPER_CONFIG,
  addTempInfo,
  removeTempInfo,
  listTempInfo,
  getTempInfoStats,
} from '../../../ai';

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) return 'just now';

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

async function handleTempInfoSubcommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string
): Promise<void> {
  switch (subcommand) {
    case 'add': {
      const text = interaction.options.getString('text', true);
      const id = await addTempInfo(text, interaction.user.id);

      if (!id) {
        const stats = await getTempInfoStats();
        await interaction.reply({
          content:
            `❌ Cannot add temp info: limit reached (${stats.count}/${stats.max})\n\n` +
            `Remove an existing entry first with \`/aihelper temp-info remove <id>\``,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content:
          `✅ **Temp info added!**\n\n` +
          `ID: \`${id}\`\n` +
          `Text: "${text}"\n\n` +
          `To remove: \`/aihelper temp-info remove ${id}\``,
        ephemeral: true,
      });
      break;
    }

    case 'remove': {
      const id = interaction.options.getString('id', true);
      const deleted = await removeTempInfo(id);

      if (!deleted) {
        await interaction.reply({
          content: `❌ Temp info with ID \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `✅ **Temp info removed!**\n\nID: \`${id}\``,
        ephemeral: true,
      });
      break;
    }

    case 'list': {
      const entries = await listTempInfo();
      const stats = await getTempInfoStats();

      if (entries.length === 0) {
        await interaction.reply({
          content:
            `📋 **Current Temp Info** (0/${stats.max})\n\n` +
            `No temp info entries. Add one with \`/aihelper temp-info add <text>\``,
          ephemeral: true,
        });
        return;
      }

      const entryLines = entries.map((entry) => {
        const truncatedText =
          entry.text.length > 100 ? entry.text.slice(0, 100) + '...' : entry.text;
        const timeAgo = formatRelativeTime(entry.createdAt);
        return `\`${entry.id}\` • ${truncatedText}\n  ↳ Added by <@${entry.createdBy}> • ${timeAgo}`;
      });

      await interaction.reply({
        content:
          `📋 **Current Temp Info** (${stats.count}/${stats.max})\n\n` + entryLines.join('\n\n'),
        ephemeral: true,
      });
      break;
    }
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('aihelper')
    .setDescription('🤖 Manage AI helper settings (Admin only)')
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Check AI helper status')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('enable').setDescription('Enable AI helper')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Disable AI helper')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset-limit')
        .setDescription('Reset rate limit for a user')
        .addUserOption((option) =>
          option.setName('user').setDescription('User to reset limit for').setRequired(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('temp-info')
        .setDescription('Manage temporary info for AI helper')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add')
            .setDescription('Add temporary info that AI will include in responses')
            .addStringOption((option) =>
              option
                .setName('text')
                .setDescription('Info text (max 500 characters)')
                .setRequired(true)
                .setMaxLength(500)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('remove')
            .setDescription('Remove temporary info by ID')
            .addStringOption((option) =>
              option.setName('id').setDescription('ID of the info to remove').setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('list').setDescription('List all temporary info entries')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireAdmin(interaction))) return;

    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    if (subcommandGroup === 'temp-info') {
      await handleTempInfoSubcommand(interaction, subcommand);
      return;
    }

    switch (subcommand) {
      case 'status': {
        const disabled = await isAiHelperDisabled();
        const configEnabled = AI_HELPER_CONFIG.enabled;
        const channelId = AI_HELPER_CONFIG.channelId;
        const vectorStoreId = AI_HELPER_CONFIG.vectorStoreId;

        const statusEmoji = disabled ? '🔴' : configEnabled ? '🟢' : '🟡';
        const statusText = disabled
          ? 'Disabled (admin)'
          : configEnabled
            ? 'Enabled'
            : 'Disabled (config)';

        await interaction.reply({
          content:
            `🤖 **AI Helper Status**\n\n` +
            `Status: ${statusEmoji} ${statusText}\n` +
            `Channel: ${channelId ? `<#${channelId}>` : '⚠️ Not configured (responds in all channels)'}\n` +
            `Vector Store: ${vectorStoreId ? `\`${vectorStoreId.slice(0, 20)}...\`` : '⚠️ Not configured'}\n` +
            `Model: \`${AI_HELPER_CONFIG.model}\`\n` +
            `Rate Limit: ${AI_HELPER_CONFIG.rateLimitRequests} req/${AI_HELPER_CONFIG.rateLimitWindowSeconds}s\n` +
            `Cooldown: ${AI_HELPER_CONFIG.cooldownSeconds}s\n` +
            `Context: ${AI_HELPER_CONFIG.contextEnabled ? `${AI_HELPER_CONFIG.contextMessages} messages` : 'Disabled'}`,
          ephemeral: true,
        });
        break;
      }

      case 'enable': {
        await enableAiHelper();
        await interaction.reply({
          content: '✅ AI helper has been **enabled**.',
          ephemeral: true,
        });
        break;
      }

      case 'disable': {
        await disableAiHelper();
        await interaction.reply({
          content: '🔒 AI helper has been **disabled**.',
          ephemeral: true,
        });
        break;
      }

      case 'reset-limit': {
        const targetUser = interaction.options.getUser('user', true);
        const beforeStatus = await getRateLimitStatus(targetUser.id);

        await resetUserRateLimit(targetUser.id);

        await interaction.reply({
          content:
            `✅ Rate limit reset for <@${targetUser.id}>\n\n` +
            `Previous usage: ${beforeStatus.requestsUsed}/${beforeStatus.requestsLimit} requests`,
          ephemeral: true,
        });
        break;
      }
    }
  },
};

export default command;
