import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { ScrapedPage } from './scraper';

const nhm = new NodeHtmlMarkdown({
  bulletMarker: '-',
  codeBlockStyle: 'fenced',
});

export function htmlToMarkdown(page: ScrapedPage): string {
  let markdown = nhm.translate(page.html);

  // Clean up excessive blank lines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  // Remove empty links and images with no alt text
  markdown = markdown.replace(/\[]\(.*?\)/g, '');

  // Trim whitespace
  markdown = markdown.trim();

  // Add metadata header
  const header = [
    `# ${page.title}`,
    `Source: ${page.url}`,
    `Last updated: ${new Date().toISOString()}`,
    '',
    '---',
    '',
  ].join('\n');

  return header + markdown;
}
