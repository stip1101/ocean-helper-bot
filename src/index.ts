import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Command, type ExtendedClient } from './bot/client';
import { setupEvents } from './bot/events';
import { startHealthServer, closeHealthServer, setHealthClient } from './health';
import { botLogger } from './utils/logger';
import { redis } from './state';

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;

if (!token) {
  botLogger.error('DISCORD_TOKEN is required');
  process.exit(1);
}

async function loadCommands(client: ExtendedClient): Promise<void> {
  const commandsPath = join(__dirname, 'bot', 'commands');

  try {
    const commandFiles = readdirSync(commandsPath).filter(
      (file) => file.endsWith('.ts') && !file.startsWith('_')
    );

    for (const file of commandFiles) {
      const module = await import(join(commandsPath, file));
      const command = module.default as Command | undefined;
      if (command && 'data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        botLogger.debug({ command: command.data.name }, 'Loaded command');
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
          client.commands.set(command.data.name, command);
          botLogger.debug({ command: command.data.name }, 'Loaded admin command');
        }
      }
    } catch {
      // Admin folder might not exist yet
    }
  } catch {
    botLogger.warn('No commands folder found yet');
  }
}

let client: ExtendedClient | null = null;

async function shutdown(signal: string): Promise<void> {
  botLogger.info({ signal }, 'Received shutdown signal');

  if (client) {
    client.destroy();
    botLogger.info('Discord client disconnected');
  }

  try {
    await closeHealthServer();
    botLogger.info('Health server closed');
  } catch (error) {
    botLogger.error({ err: error }, 'Error closing health server');
  }

  try {
    await redis.quit();
    botLogger.info('Redis connection closed');
  } catch (error) {
    botLogger.error({ err: error }, 'Error closing Redis connection');
  }

  botLogger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main(): Promise<void> {
  botLogger.info('Starting OnCompute AI Helper Bot');

  startHealthServer(3000);

  client = createClient();

  setHealthClient(client);

  setupEvents(client);

  await loadCommands(client);

  await client.login(token);
}

main().catch((error) => {
  botLogger.error({ err: error }, 'Failed to start bot');
  process.exit(1);
});
