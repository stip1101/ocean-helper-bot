import { initializeVectorStore } from '../ai/vector-store';
import { aiLogger } from '../ai/openai-client';

const force = process.argv.includes('--force');

async function main(): Promise<void> {
  aiLogger.info({ force }, 'Initializing vector store...');

  try {
    const vectorStoreId = await initializeVectorStore(force);
    aiLogger.info({ vectorStoreId }, 'Vector store ready');
    console.log(`\nVector Store ID: ${vectorStoreId}`);
    console.log('Add this to your .env file as OPENAI_VECTOR_STORE_ID');
  } catch (error) {
    aiLogger.error({ err: error }, 'Failed to initialize vector store');
    process.exit(1);
  }

  process.exit(0);
}

main();
