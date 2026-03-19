import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from 'discord.js';

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ExtendedClient extends Client {
  commands: Collection<string, Command>;
}

export function createClient(): ExtendedClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  }) as ExtendedClient;

  client.commands = new Collection();

  return client;
}
