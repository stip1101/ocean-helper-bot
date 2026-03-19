import type { Interaction, ChatInputCommandInteraction } from 'discord.js';
import type { ExtendedClient } from '../client';
import { botLogger } from '../../utils/logger';

export function setupInteractionCreateEvent(client: ExtendedClient): void {
  client.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(client, interaction);
      }
    } catch (error) {
      botLogger.error({ err: error, userId: interaction.user?.id }, 'Error handling interaction');
      await handleInteractionError(interaction);
    }
  });
}

async function handleSlashCommand(
  client: ExtendedClient,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    botLogger.warn({ commandName: interaction.commandName }, 'Command not found');
    await interaction.reply({
      content: '❌ Unknown command.',
      ephemeral: true,
    });
    return;
  }

  await command.execute(interaction);
}

async function handleInteractionError(interaction: Interaction): Promise<void> {
  const errorMessage = '❌ An error occurred while processing your request.';

  try {
    if (interaction.isRepliable()) {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else if (interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  } catch {
    botLogger.error('Failed to send error message to user');
  }
}
