import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../client';
import { requireAdmin } from '../../../utils/guards';
import { getVectorStoreInfo, AI_HELPER_CONFIG, aiLogger } from '../../../ai';
import { refreshKnowledgeBase } from '../../../scraper/pipeline';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('📚 Manage knowledge base (Admin only)')
    .addSubcommand((subcommand) =>
      subcommand.setName('refresh').setDescription('Re-scrape oncompute.ai and update the knowledge base')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Check knowledge base status')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireAdmin(interaction))) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'refresh': {
        await interaction.deferReply({ ephemeral: true });

        try {
          const result = await refreshKnowledgeBase();

          await interaction.editReply({
            content:
              `✅ **Knowledge base refreshed!**\n\n` +
              `Pages scraped: ${result.pagesScraped}\n` +
              `Pages failed: ${result.pagesFailed}\n` +
              `Files uploaded: ${result.filesUploaded}\n` +
              `Duration: ${result.durationMs}ms`,
          });
        } catch (error) {
          aiLogger.error({ err: error }, 'Knowledge refresh failed');
          await interaction.editReply({
            content: '❌ Knowledge base refresh failed. Check logs for details.',
          });
        }
        break;
      }

      case 'status': {
        const vectorStoreId = AI_HELPER_CONFIG.vectorStoreId;
        if (!vectorStoreId) {
          await interaction.reply({
            content: '⚠️ Vector store not configured. Set OPENAI_VECTOR_STORE_ID in .env',
            ephemeral: true,
          });
          return;
        }

        try {
          const info = await getVectorStoreInfo(vectorStoreId);
          await interaction.reply({
            content:
              `📚 **Knowledge Base Status**\n\n` +
              `Name: ${info.name}\n` +
              `Status: ${info.status}\n` +
              `Files: ${info.fileCount}\n` +
              `Size: ${(info.usageBytes / 1024).toFixed(1)} KB\n` +
              `Expires: ${info.expiresAt ? info.expiresAt.toLocaleDateString() : 'Never'}`,
            ephemeral: true,
          });
        } catch (error) {
          aiLogger.error({ err: error }, 'Failed to get vector store info');
          await interaction.reply({
            content: '❌ Failed to get vector store info. Check logs.',
            ephemeral: true,
          });
        }
        break;
      }
    }
  },
};

export default command;
