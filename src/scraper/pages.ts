export interface PageConfig {
  url: string;
  filename: string;
  selector: string;
}

export const PAGES_TO_SCRAPE: PageConfig[] = [
  {
    url: 'https://www.oncompute.ai/',
    filename: 'homepage',
    selector: 'main, .main-wrapper, body',
  },
  {
    url: 'https://www.oncompute.ai/faq',
    filename: 'faq',
    selector: 'main, .main-wrapper, body',
  },
  {
    url: 'https://www.oncompute.ai/gpu-compute',
    filename: 'gpu-compute',
    selector: 'main, .main-wrapper, body',
  },
  {
    url: 'https://www.oncompute.ai/products',
    filename: 'products',
    selector: 'main, .main-wrapper, body',
  },
  {
    url: 'https://www.oncompute.ai/ocean-orchestrator',
    filename: 'ocean-orchestrator',
    selector: 'main, .main-wrapper, body',
  },
];
