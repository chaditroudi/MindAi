import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

interface SearchProvider {
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
    if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
    const data = (await res.json()) as { results: Array<{ title: string; url: string; content: string; published_date?: string }> };
    return data.results.map((r) => ({
      title: r.title, url: r.url, snippet: r.content, publishedAt: r.published_date,
    }));
  }
  async fetch(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Web fetch failed for ${url}: ${res.status}`);
    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      url,
      title: titleMatch?.[1]?.trim(),
      text,
    };
  }
}

function getProvider(): SearchProvider {
  const which = process.env.SEARCH_PROVIDER?.trim();
  if (which === 'tavily' && process.env.TAVILY_API_KEY) {
    return new TavilyProvider(process.env.TAVILY_API_KEY);
  }

  if (!which) {
    throw new Error('SEARCH_PROVIDER is not configured. Set SEARCH_PROVIDER=tavily and provide TAVILY_API_KEY to enable external enrichment.');
  }

  if (which === 'tavily' && !process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is required when SEARCH_PROVIDER=tavily.');
  }

  throw new Error(`Unsupported SEARCH_PROVIDER "${which}".`);
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
    return { hits };
  },
});

export const webFetchTool = createTool({
  id: 'web-fetch',
  description: 'Fetch the full text of a URL discovered via web-search.',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({
    url: z.string(),
    title: z.string().optional(),
    text: z.string(),
  }),
  execute: async ({ context }) => {
    const provider = getProvider();
    return provider.fetch(context.url);
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
    throw new Error(
      `Vector search is not configured for tenant "${context.tenantId}". Wire this tool to the production knowledge store before enabling internal-corpus enrichment.`,
    );
  },
});
