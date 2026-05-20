import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { log } from '../../observability/log.js';
import { semanticSearchExportKnowledge } from '../../knowledge/export-knowledge.js';

/**
 * Search provider abstraction.
 *
 * Two real providers are wired:
 *   - Tavily : LLM-tuned search; supports an /extract endpoint that returns
 *              clean article text (much better than raw HTML for downstream
 *              summarization).
 *   - Brave  : alternative search; web-fetch uses direct HTML-to-text extraction
 *              because Brave doesn't ship an extraction endpoint.
 */

interface SearchProvider {
  readonly name: 'tavily' | 'brave';
  search(query: string, opts?: { allowList?: string[]; limit?: number }): Promise<SearchHit[]>;
  fetch(url: string): Promise<{ url: string; title?: string; text: string }>;
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

class TavilyProvider implements SearchProvider {
  readonly name = 'tavily' as const;
  constructor(private apiKey: string) {}

  async search(query: string, opts?: { allowList?: string[]; limit?: number }): Promise<SearchHit[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: opts?.limit ?? 5,
        include_domains: opts?.allowList,
      }),
    });
    if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as {
      results: Array<{ title: string; url: string; content: string; published_date?: string }>;
    };
    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedAt: r.published_date,
    }));
  }

  /**
   * Use Tavily's /extract endpoint to get clean article text instead of HTML.
   * If /extract is unavailable for a target URL, use direct HTML-to-text
   * extraction so callers still receive readable content.
   */
  async fetch(url: string) {
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, urls: [url] }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{ url: string; raw_content?: string; title?: string }>;
        };
        const hit = data.results?.[0];
        if (hit?.raw_content) {
          return { url, title: hit.title, text: hit.raw_content };
        }
      } else {
        log.warn('search.tavily-extract-failed', { status: res.status, url });
      }
    } catch (err) {
      log.warn('search.tavily-extract-error', {
        url,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return fetchHtmlAsText(url);
  }
}

class BraveProvider implements SearchProvider {
  readonly name = 'brave' as const;
  constructor(private apiKey: string) {}

  async search(query: string, opts?: { allowList?: string[]; limit?: number }): Promise<SearchHit[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(opts?.limit ?? 5),
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });
    if (!res.ok) throw new Error(`Brave search failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as {
      web?: {
        results?: Array<{ title: string; url: string; description?: string; age?: string }>;
      };
    };
    const all = data.web?.results ?? [];
    const allowed = opts?.allowList?.length
      ? all.filter((r) => opts.allowList!.some((d) => safeHostname(r.url).endsWith(d)))
      : all;
    return allowed.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? '',
      publishedAt: r.age,
    }));
  }

  async fetch(url: string) {
    // Brave has no extraction endpoint; fetch the page directly and strip HTML.
    return fetchHtmlAsText(url);
  }
}

/** HTML -> text extraction used when no dedicated extraction endpoint is available. */
async function fetchHtmlAsText(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'mind-viz-agents/0.1 (+search-fetch)' },
  });
  if (!res.ok) throw new Error(`Web fetch failed for ${url}: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    url,
    title: titleMatch?.[1]?.trim(),
    text: stripHtml(html),
  };
}

/** Light HTML stripper. Not a full DOM parser, but enough to keep an LLM from
 *  drowning in tag soup. Removes script/style/noscript blocks first, then
 *  tags, collapses whitespace, decodes the handful of entities that matter. */
function stripHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const plain = withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  // 200KB cap protects the LLM context window from oversized pages.
  return plain.length > 200_000 ? plain.slice(0, 200_000) + '… [truncated]' : plain;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function getProvider(): SearchProvider {
  const which = process.env.SEARCH_PROVIDER?.trim().toLowerCase();

  if (!which) {
    throw new Error('SEARCH_PROVIDER is required for web enrichment. Supported values: tavily, brave.');
  }

  if (which === 'tavily') {
    const key = process.env.TAVILY_API_KEY?.trim();
    if (!key) throw new Error('TAVILY_API_KEY is required when SEARCH_PROVIDER=tavily.');
    return new TavilyProvider(key);
  }

  if (which === 'brave') {
    const key = process.env.BRAVE_API_KEY?.trim();
    if (!key) throw new Error('BRAVE_API_KEY is required when SEARCH_PROVIDER=brave.');
    return new BraveProvider(key);
  }

  throw new Error(`Unsupported SEARCH_PROVIDER "${which}". Supported values: tavily, brave.`);
}

export const webSearchTool = createTool({
  id: 'web-search',
  description:
    'Search the public web for external context — benchmarks, news, definitions. Respects an optional domain allow-list.',
  inputSchema: z.object({
    query: z.string(),
    allowList: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  outputSchema: z.object({
    hits: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
        publishedAt: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const provider = getProvider();
    const hits = await provider.search(context.query, {
      allowList: context.allowList,
      limit: context.limit,
    });
    log.info('search.web-search', { provider: provider.name, count: hits.length });
    return { hits };
  },
});

export const webFetchTool = createTool({
  id: 'web-fetch',
  description:
    'Fetch a URL discovered via web-search and return clean text. With Tavily this prefers /extract; with Brave it uses direct HTML-to-text extraction.',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({
    url: z.string(),
    title: z.string().optional(),
    text: z.string(),
  }),
  execute: async ({ context }) => {
    const provider = getProvider();
    const result = await provider.fetch(context.url);
    log.info('search.web-fetch', {
      provider: provider.name,
      url: context.url,
      textLength: result.text.length,
    });
    return result;
  },
});

export const vectorSearchTool = createTool({
  id: 'vector-search',
  description: 'Semantic search over the Mind Platform internal knowledge corpus.',
  inputSchema: z.object({
    query: z.string(),
    topK: z.number().int().min(1).max(20).default(5),
    tenantId: z.string(),
  }),
  outputSchema: z.object({
    chunks: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        source: z.string(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const hits = await semanticSearchExportKnowledge(context.query, context.topK, context.tenantId);
    log.info('search.vector-search', {
      tenantId: context.tenantId,
      queryLength: context.query.length,
      topK: context.topK,
      hitCount: hits.length,
    });
    return {
      chunks: hits.map((hit) => ({
        id: hit.id,
        text: hit.text,
        source: hit.collection,
        score: hit.score,
      })),
    };
  },
});
