import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { PlexError, Pms, normItem } from './plex.js';
import type { Account } from './config.js';

/**
 * "Recent" (continue watching, recently watched, recently added per library) and "Stats"
 * (aggregates over Plex's play history).
 */

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DUR_FILE = path.join(DATA_DIR, 'durations.json');

// ---------------------------------------------------------------- helpers

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Server account IDs (as used in play history) by name. */
let serverAccounts: { at: number; list: { id: number; name: string }[] } | undefined;
async function serverAccountList(p: Pms) {
  if (serverAccounts && Date.now() - serverAccounts.at < 10 * 60_000) return serverAccounts.list;
  const j = await p.get('/accounts');
  const list = ((j?.MediaContainer?.Account ?? []) as any[])
    .filter((a) => a.name)
    .map((a) => ({ id: Number(a.id), name: String(a.name) }));
  serverAccounts = { at: Date.now(), list };
  return list;
}

/** The play-history account ID for one of our profiles. The server owner is always 1. */
async function historyAccountId(lib: Pms, acct: Account): Promise<number | undefined> {
  const list = await serverAccountList(lib).catch(() => []);
  const byName = list.find((a) => a.name.toLowerCase() === acct.name.toLowerCase());
  if (byName) return byName.id;
  return acct.serverOwner ? 1 : undefined;
}

/** Look up many items at once (Plex accepts comma-separated ratingKeys). Missing (deleted) ones are skipped. */
async function metadataFor(p: Pms, keys: string[], chunk = 50): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += chunk) chunks.push(keys.slice(i, i + chunk));
  await mapLimit(chunks, 4, async (c) => {
    try {
      const j = await p.get(`/library/metadata/${c.join(',')}`);
      for (const m of j?.MediaContainer?.Metadata ?? []) out.set(String(m.ratingKey), m);
    } catch (e) {
      // One deleted key can fail the whole batch; fall back to one at a time.
      if (c.length > 1 && e instanceof PlexError && e.status === 404) {
        const each = await metadataFor(p, c, 1);
        for (const [k, v] of each) out.set(k, v);
      }
    }
  });
  return out;
}

async function sectionList(p: Pms) {
  const j = await p.get('/library/sections');
  return ((j?.MediaContainer?.Directory ?? []) as any[]).map((d) => ({ key: String(d.key), title: String(d.title), type: String(d.type) }));
}

const withProgress = (m: any) => ({
  ...normItem(m),
  viewOffset: m.viewOffset as number | undefined,
  lastViewedAt: m.lastViewedAt as number | undefined,
});

// ---------------------------------------------------------------- durations cache (for watch time)

let durations: Record<string, number> | undefined;
function loadDurations() {
  if (durations) return durations;
  try {
    durations = JSON.parse(fs.readFileSync(DUR_FILE, 'utf8'));
  } catch {
    durations = {};
  }
  return durations!;
}
let saveTimer: NodeJS.Timeout | undefined;
function saveDurations() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DUR_FILE, JSON.stringify(durations));
    } catch {
      /* not fatal */
    }
  }, 1000);
}

// ---------------------------------------------------------------- stats

export interface StatsData {
  generatedAt: number;
  accounts: { id: number; name: string }[];
  libraries: { key: string; title: string; type: string }[];
  devices: { id: number; name: string }[];
  /** Grouped titles: movies by themselves, episodes by show, tracks by artist. */
  titles: { key: string; title: string; type: string; thumb?: string; lib: number }[];
  /** [viewedAt (unix s), title index, account index, minutes, library index, device index (-1 unknown), estimated (1/0)] */
  plays: [number, number, number, number, number, number, number][];
  unknownDuration: number;
}

let statsCache: { at: number; data: StatsData } | undefined;
let statsBuilding: Promise<StatsData> | undefined;

async function buildStats(lib: Pms): Promise<StatsData> {
  const { items: history } = await lib.getAll('/status/sessions/history/all', { sort: 'viewedAt:desc' });
  const [accounts, libraries] = await Promise.all([serverAccountList(lib).catch(() => []), sectionList(lib)]);
  let devices: { id: number; name: string }[] = [];
  try {
    const j = await lib.get('/devices');
    devices = ((j?.MediaContainer?.Device ?? []) as any[]).map((d) => ({ id: Number(d.id), name: String(d.name || d.platform || `Device ${d.id}`) }));
  } catch {
    /* older servers */
  }

  // Durations: cached on disk, looked up for anything new.
  const dur = loadDurations();
  const missing = [...new Set(history.map((h) => String(h.ratingKey)).filter((k) => k && k !== 'undefined' && dur[k] === undefined))];
  if (missing.length) {
    const meta = await metadataFor(lib, missing);
    for (const k of missing) {
      const d = Number(meta.get(k)?.duration);
      dur[k] = Number.isFinite(d) && d > 0 ? d : 0; // 0 = unknown (deleted from the library)
    }
    saveDurations();
  }

  const libIndex = new Map(libraries.map((l, i) => [l.key, i]));
  const acctIndex = new Map<number, number>();
  const acctList = [...accounts];
  const devIndex = new Map(devices.map((d, i) => [d.id, i]));
  const titles: StatsData['titles'] = [];
  const titleIndex = new Map<string, number>();

  const groupOf = (h: any) => {
    if (h.type === 'episode' && h.grandparentKey) {
      return { key: String(h.grandparentKey).split('/').pop()!, title: h.grandparentTitle ?? h.title, type: 'show', thumb: h.grandparentThumb ?? h.parentThumb ?? h.thumb };
    }
    if (h.type === 'track' && h.grandparentKey) {
      return { key: String(h.grandparentKey).split('/').pop()!, title: h.grandparentTitle ?? h.title, type: 'artist', thumb: h.grandparentThumb ?? h.thumb };
    }
    return { key: String(h.ratingKey), title: h.title ?? '(untitled)', type: String(h.type ?? 'other'), thumb: h.thumb };
  };

  // Average known length per library, used for plays of titles that were since deleted.
  const sums = new Map<string, { t: number; n: number }>();
  for (const h of history) {
    const d = dur[String(h.ratingKey)];
    if (!d) continue;
    const s = sums.get(String(h.librarySectionID)) ?? { t: 0, n: 0 };
    s.t += d;
    s.n++;
    sums.set(String(h.librarySectionID), s);
  }

  let unknownDuration = 0;
  const plays: StatsData['plays'] = [];
  for (const h of history) {
    if (!h.viewedAt) continue;
    const g = groupOf(h);
    let ti = titleIndex.get(g.key);
    if (ti === undefined) {
      ti = titles.length;
      titleIndex.set(g.key, ti);
      titles.push({ ...g, lib: libIndex.get(String(h.librarySectionID)) ?? -1 });
    }
    const aid = Number(h.accountID);
    let ai = acctIndex.get(aid);
    if (ai === undefined) {
      ai = acctList.findIndex((a) => a.id === aid);
      if (ai < 0) {
        ai = acctList.length;
        acctList.push({ id: aid, name: `Account ${aid}` });
      }
      acctIndex.set(aid, ai);
    }
    let ms = dur[String(h.ratingKey)] ?? 0;
    let est = 0;
    if (!ms) {
      const s = sums.get(String(h.librarySectionID));
      if (s?.n) {
        ms = s.t / s.n;
        est = 1;
      } else unknownDuration++;
    }
    plays.push([
      Number(h.viewedAt),
      ti,
      ai,
      Math.round(ms / 60000),
      libIndex.get(String(h.librarySectionID)) ?? -1,
      devIndex.get(Number(h.deviceID)) ?? -1,
      est,
    ]);
  }
  return { generatedAt: Date.now(), accounts: acctList, libraries, devices, titles, plays, unknownDuration };
}

async function getStats(lib: Pms, force: boolean) {
  if (!force && statsCache && Date.now() - statsCache.at < 10 * 60_000) return statsCache.data;
  statsBuilding ??= buildStats(lib).finally(() => (statsBuilding = undefined));
  const data = await statsBuilding;
  statsCache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------- routes

export function registerActivityRoutes(
  router: Router,
  pms: (res: Response) => Pms,
  libPms: (res: Response) => Pms,
  account: (req: Request) => Account,
) {
  /** Continue watching / up next for this profile. */
  router.get('/recent/continue', async (_req, res) => {
    const p = pms(res);
    let list: any[] = [];
    try {
      const j = await p.get('/hubs/continueWatching/items', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 40 });
      list = j?.MediaContainer?.Metadata ?? [];
    } catch {
      const j = await p.get('/library/onDeck', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 40 });
      list = j?.MediaContainer?.Metadata ?? [];
    }
    res.json(list.map(withProgress));
  });

  /** This profile's most recent plays, newest first. */
  router.get('/recent/watched', async (req, res) => {
    const lib = libPms(res);
    const acct = account(req);
    const size = Math.min(200, Math.max(1, Number(req.query.size) || 60));
    const sec = req.query.sec ? String(req.query.sec) : undefined;
    const accountID = await historyAccountId(lib, acct);
    let j: any;
    if (accountID !== undefined) {
      j = await lib.get('/status/sessions/history/all', {
        sort: 'viewedAt:desc',
        accountID,
        librarySectionID: sec,
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': size,
      });
    } else {
      // Unknown on the server: the profile's own token only sees its own history.
      j = await pms(res).get('/status/sessions/history/all', {
        sort: 'viewedAt:desc',
        librarySectionID: sec,
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': size,
      });
    }
    const hist: any[] = j?.MediaContainer?.Metadata ?? [];
    const meta = await metadataFor(lib, [...new Set(hist.map((h) => String(h.ratingKey)))]);
    const sections = new Map((await sectionList(lib)).map((s) => [s.key, s.title]));
    res.json(
      hist.map((h) => {
        const m = meta.get(String(h.ratingKey));
        const base = m ? normItem(m) : normItem({ ...h, librarySectionTitle: sections.get(String(h.librarySectionID)) });
        return { ...base, viewedAt: Number(h.viewedAt), deleted: !m };
      }),
    );
  });

  /** Recently added, for every library this profile can see. */
  router.get('/recent/added', async (req, res) => {
    const p = pms(res);
    const size = Math.min(50, Math.max(1, Number(req.query.size) || 16));
    const libs = (await sectionList(p)).filter((l) => ['movie', 'show', 'artist'].includes(l.type));
    const out = await mapLimit(libs, 6, async (l) => {
      try {
        const j = await p.get(`/library/sections/${l.key}/recentlyAdded`, { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': size });
        return { ...l, items: ((j?.MediaContainer?.Metadata ?? []) as any[]).map(withProgress) };
      } catch (e: any) {
        return { ...l, items: [], error: e?.message ?? String(e) };
      }
    });
    res.json(out);
  });

  /** Every play on the server (all profiles), for the Stats tab. Cached for 10 minutes. */
  router.get('/stats', async (req, res) => {
    res.json(await getStats(libPms(res), req.query.refresh === '1'));
  });

  /** How much of each library this profile has watched. */
  router.get('/stats/libraries', async (_req, res) => {
    const p = pms(res);
    const libs = (await sectionList(p)).filter((l) => ['movie', 'show'].includes(l.type));
    const count = async (sec: string, type: number, extra: Record<string, number> = {}) => {
      const j = await p.get(`/library/sections/${sec}/all`, { type, ...extra, 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 });
      return Number(j?.MediaContainer?.totalSize ?? 0);
    };
    const out = await mapLimit(libs, 4, async (l) => {
      const type = l.type === 'show' ? 4 : 1;
      try {
        const [total, unwatched] = await Promise.all([count(l.key, type), count(l.key, type, { unwatched: 1 })]);
        return { ...l, unit: l.type === 'show' ? 'episodes' : 'titles', total, watched: total - unwatched };
      } catch {
        return { ...l, unit: '', total: 0, watched: 0 };
      }
    });
    res.json(out);
  });
}
