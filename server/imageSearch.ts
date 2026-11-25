import type { Express } from 'express';
import { getConfig, saveConfig } from './config.js';
import { PlexError } from './plex.js';

/** Web image search through SerpApi's Google Images engine. */

const BASE = (process.env.SERPAPI_BASE || 'https://serpapi.com').replace(/\/+$/, '');
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface ImageResult {
  thumbnail: string;
  original: string;
  width?: number;
  height?: number;
  title?: string;
  source?: string;
  link?: string;
}

const cache = new Map<string, { at: number; results: ImageResult[] }>();

const apiKey = () => process.env.SERPAPI_KEY || getConfig().serpApiKey || '';

async function serp(path: string, params: Record<string, string>) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let r: Response;
  try {
    r = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
  } catch (e: any) {
    throw new PlexError(502, `Could not reach SerpApi: ${e?.cause?.code ?? e?.message ?? e}`);
  }
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401 || /invalid api key/i.test(j?.error ?? '')) throw new PlexError(400, 'SerpApi rejected the API key. Check it on the Accounts page.');
  if (r.status === 429 || /run out of searches|plan limit/i.test(j?.error ?? '')) {
    throw new PlexError(429, 'Your SerpApi searches for this month are used up. Use "Open in Google Images" instead, or wait for the monthly reset.');
  }
  if (!r.ok || j?.error) {
    // "Google hasn't returned any results" is reported as an error by SerpApi.
    if (/hasn't returned any results/i.test(j?.error ?? '')) return { images_results: [] };
    throw new PlexError(502, `SerpApi: ${j?.error ?? `${r.status} ${r.statusText}`}`);
  }
  return j;
}

async function accountInfo(key: string) {
  const j = await serp('/account.json', { api_key: key });
  return {
    plan: (j.plan_name ?? j.plan_id) as string | undefined,
    searchesLeft: (j.total_searches_left ?? j.plan_searches_left) as number | undefined,
    perMonth: j.searches_per_month as number | undefined,
  };
}

export function registerImageSearchRoutes(app: Express) {
  app.get('/api/image-search/status', async (_req, res) => {
    const key = apiKey();
    if (!key) return void res.json({ configured: false, lockedByEnv: false });
    let info: Awaited<ReturnType<typeof accountInfo>> | undefined;
    let error: string | undefined;
    try {
      info = await accountInfo(key);
    } catch (e: any) {
      error = e?.message;
    }
    res.json({ configured: true, lockedByEnv: !!process.env.SERPAPI_KEY, ...info, error });
  });

  app.put('/api/image-search/key', async (req, res) => {
    if (process.env.SERPAPI_KEY) throw new PlexError(400, 'The key is set by the SERPAPI_KEY environment variable.');
    const key = String(req.body?.key ?? '').trim();
    if (!/^[A-Za-z0-9]{20,128}$/.test(key)) throw new PlexError(400, "That doesn't look like a SerpApi key.");
    const info = await accountInfo(key); // validates without using a search
    getConfig().serpApiKey = key;
    saveConfig();
    res.json({ configured: true, ...info });
  });

  app.delete('/api/image-search/key', (_req, res) => {
    delete getConfig().serpApiKey;
    saveConfig();
    res.json({ configured: false });
  });

  app.get('/api/image-search', async (req, res) => {
    const key = apiKey();
    if (!key) throw new PlexError(400, 'Add a SerpApi key on the Accounts page to search images here.');
    const q = String(req.query.q ?? '').trim().slice(0, 300);
    if (!q) throw new PlexError(400, 'Type something to search for');
    const page = Math.max(0, Math.min(10, Number(req.query.page) || 0));
    const ck = `${q.toLowerCase()}|${page}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_MS) return void res.json({ results: hit.results, cached: true });

    const j = await serp('/search.json', { engine: 'google_images', q, ijn: String(page), api_key: key });
    const results: ImageResult[] = ((j.images_results ?? []) as any[])
      .filter((x) => typeof x.original === 'string' && /^https?:\/\//i.test(x.original))
      .map((x) => ({
        thumbnail: x.thumbnail ?? x.original,
        original: x.original,
        width: x.original_width,
        height: x.original_height,
        title: x.title,
        source: x.source,
        link: x.link,
      }));
    cache.set(ck, { at: Date.now(), results });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    res.json({ results, cached: false });
  });
}
