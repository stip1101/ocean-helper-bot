import type { ExtendedClient } from '../client';
import { setupReadyEvent } from './ready';
import { setupInteractionCreateEvent } from './interactionCreate';
import { setupMessageCreateEvent } from './messageCreate';

export function setupEvents(client: ExtendedClient): void {
  setupReadyEvent(client);
  setupInteractionCreateEvent(client);
  setupMessageCreateEvent(client);
}
