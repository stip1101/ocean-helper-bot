import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiLogger } from '../ai/openai-client';
import { clearVectorStoreFiles, uploadKnowledgeBase } from '../ai/vector-store';
import { AI_HELPER_CONFIG } from '../ai/config';
import { scrapeAllPages } from './scraper';
import { htmlToMarkdown } from './markdown-generator';
import { PAGES_TO_SCRAPE } from './pages';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge');

export interface RefreshResult {
  pagesScraped: number;
  pagesFailed: number;
  filesUploaded: number;
  durationMs: number;
}

export async function refreshKnowledgeBase(): Promise<RefreshResult> {
  const startTime = Date.now();

  aiLogger.info('Starting knowledge base refresh...');

  // Step 1: Scrape pages
  const scrapedPages = await scrapeAllPages(PAGES_TO_SCRAPE);
  const pagesFailed = PAGES_TO_SCRAPE.length - scrapedPages.length;

  if (scrapedPages.length === 0) {
    throw new Error('No pages were scraped successfully');
  }

  // Step 2: Generate markdown files
  for (const page of scrapedPages) {
    const markdown = htmlToMarkdown(page);
    const filePath = join(KNOWLEDGE_DIR, `${page.filename}.md`);
    writeFileSync(filePath, markdown, 'utf-8');
    aiLogger.debug({ filename: page.filename, size: markdown.length }, 'Markdown file written');
  }

  // Step 3: Upload to vector store
  const vectorStoreId = AI_HELPER_CONFIG.vectorStoreId;
  if (!vectorStoreId) {
    throw new Error('OPENAI_VECTOR_STORE_ID not configured');
  }

  await clearVectorStoreFiles(vectorStoreId);
  await uploadKnowledgeBase(vectorStoreId);

  const durationMs = Date.now() - startTime;

  aiLogger.info(
    { pagesScraped: scrapedPages.length, pagesFailed, durationMs },
    'Knowledge base refresh completed'
  );

  return {
    pagesScraped: scrapedPages.length,
    pagesFailed,
    filesUploaded: scrapedPages.length,
    durationMs,
  };
}
