import type { ExtendedClient } from '../client';
import { botLogger } from '../../utils/logger';

export function setupReadyEvent(client: ExtendedClient): void {
  client.once('ready', () => {
    botLogger.info({ tag: client.user?.tag, guilds: client.guilds.cache.size }, 'Bot logged in');
  });
}
