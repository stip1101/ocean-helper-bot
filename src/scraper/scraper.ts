import * as cheerio from 'cheerio';
import { aiLogger } from '../ai/openai-client';
import type { PageConfig } from './pages';

export interface ScrapedPage {
  url: string;
  filename: string;
  title: string;
  html: string;
}

export async function scrapePage(page: PageConfig): Promise<ScrapedPage | null> {
  try {
    const response = await fetch(page.url, {
      headers: {
        'User-Agent': 'OnComputeBot/1.0 (Knowledge Base Scraper)',
      },
    });

    if (!response.ok) {
      aiLogger.warn({ url: page.url, status: response.status }, 'Failed to fetch page');
      return null;
    }

    const rawHtml = await response.text();
    const $ = cheerio.load(rawHtml);

    // Remove noise elements
    $('script, style, nav, footer, header, iframe, noscript, .cookie-banner, .popup').remove();

    // Try selectors in order (first match wins)
    const selectors = page.selector.split(',').map((s) => s.trim());
    let contentHtml = '';

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        contentHtml = element.html() || '';
        break;
      }
    }

    if (!contentHtml) {
      contentHtml = $('body').html() || '';
    }

    const title = $('title').text().trim() || $('h1').first().text().trim() || page.filename;

    aiLogger.info({ url: page.url, title, htmlLength: contentHtml.length }, 'Page scraped');

    return {
      url: page.url,
      filename: page.filename,
      title,
      html: contentHtml,
    };
  } catch (error) {
    aiLogger.error({ err: error, url: page.url }, 'Error scraping page');
    return null;
  }
}

export async function scrapeAllPages(pages: PageConfig[]): Promise<ScrapedPage[]> {
  const results: ScrapedPage[] = [];

  for (const page of pages) {
    const result = await scrapePage(page);
    if (result) {
      results.push(result);
    }
  }

  aiLogger.info(
    { total: pages.length, scraped: results.length, failed: pages.length - results.length },
    'Scraping complete'
  );

  return results;
}
