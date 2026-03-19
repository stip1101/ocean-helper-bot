import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  GuildMember,
} from 'discord.js';

type SupportedInteraction = ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction;

export async function requireAdmin(interaction: SupportedInteraction): Promise<boolean> {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) {
    await interaction.reply({
      content: '❌ ADMIN_ROLE_ID is not configured.',
      ephemeral: true,
    });
    return false;
  }

  const member = interaction.member as GuildMember | null;
  const hasAdminRole = member?.roles?.cache?.has(adminRoleId) ?? false;

  if (!hasAdminRole) {
    await interaction.reply({
      content: '❌ You do not have permission to use this command.',
      ephemeral: true,
    });
    return false;
  }

  return true;
}
