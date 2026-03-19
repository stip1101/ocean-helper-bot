import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from './client';
import { botLogger } from '../utils/logger';

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  botLogger.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
  process.exit(1);
}

async function loadCommands(): Promise<Command[]> {
  const commands: Command[] = [];
  const commandsPath = join(__dirname, 'commands');

  try {
    const commandFiles = readdirSync(commandsPath).filter(
      (file) => file.endsWith('.ts') && !file.startsWith('_')
    );

    for (const file of commandFiles) {
      const module = await import(join(commandsPath, file));
      const command = module.default as Command | undefined;
      if (command && 'data' in command && 'execute' in command) {
        commands.push(command);
      }
    }

    const adminPath = join(commandsPath, 'admin');
    try {
      const adminFiles = readdirSync(adminPath).filter(
        (file) => file.endsWith('.ts') && !file.startsWith('_')
      );

      for (const file of adminFiles) {
        const module = await import(join(adminPath, file));
        const command = module.default as Command | undefined;
        if (command && 'data' in command && 'execute' in command) {
          commands.push(command);
        }
      }
    } catch {
      // Admin folder might not exist yet
    }
  } catch {
    botLogger.warn('No commands folder found yet');
  }

  return commands;
}

async function deployCommands(): Promise<void> {
  const commands = await loadCommands();
  const commandsData = commands.map((cmd) => cmd.data.toJSON());

  botLogger.info({ count: commandsData.length }, 'Deploying commands');

  const rest = new REST().setToken(token!);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId!, guildId), {
        body: commandsData,
      });
      botLogger.info({ count: commandsData.length, guildId }, 'Successfully deployed guild commands');
    } else {
      await rest.put(Routes.applicationCommands(clientId!), {
        body: commandsData,
      });
      botLogger.info({ count: commandsData.length }, 'Successfully deployed global commands');
    }
  } catch (error) {
    botLogger.error({ err: error }, 'Failed to deploy commands');
    process.exit(1);
  }
}

deployCommands();
