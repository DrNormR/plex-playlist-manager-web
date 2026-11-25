import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig, saveConfig, publicAccount, upsertAccount, type Account } from './config.js';
import {
  PlexError, Pms, plexTv, serverIdentity, serverTokenFor,
  normItem, normPlaylist, normCollection, playlistTypeFor, TYPE_NUM,
} from './plex.js';
import { planMoves } from './reorder.js';

const PORT = Number(process.env.PORT || 8080);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const cfg = getConfig();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// ---------------------------------------------------------------- app login (optional)

const sessionValue = () => crypto.createHmac('sha256', cfg.sessionSecret).update('ppm:' + APP_PASSWORD).digest('hex');

function cookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const isAuthed = (req: Request) => !APP_PASSWORD || safeEqual(cookie(req, 'ppm_session') ?? '', sessionValue());

app.get('/api/session', (req, res) => {
  res.json({ authRequired: !!APP_PASSWORD, authenticated: isAuthed(req) });
});

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return void res.json({ ok: true });
  if (typeof req.body?.password === 'string' && safeEqual(req.body.password, APP_PASSWORD)) {
    res.setHeader('Set-Cookie', `ppm_session=${sessionValue()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
    return void res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'ppm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Login required', code: 'LOGIN' });
});

// ---------------------------------------------------------------- settings

app.get('/api/settings', async (_req, res) => {
  let reachable = false;
  if (cfg.serverUrl) {
    try {
      await serverIdentity(cfg.serverUrl);
      reachable = true;
    } catch {
      /* report as unreachable */
    }
  }
  res.json({ serverUrl: cfg.serverUrl, reachable, lockedByEnv: !!process.env.PLEX_URL });
});

app.put('/api/settings', async (req, res) => {
  const url = String(req.body?.serverUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(url)) throw new PlexError(400, 'Server URL must start with http:// or https://');
  await serverIdentity(url);
  cfg.serverUrl = url;
  saveConfig();
  res.json({ serverUrl: url, reachable: true });
});

// ---------------------------------------------------------------- accounts

app.get('/api/accounts', (_req, res) => {
  res.json(cfg.accounts.map(publicAccount));
});

const pendingPins = new Map<string, number>();

app.post('/api/auth/pin', async (_req, res) => {
  const pin = await plexTv.createPin();
  pendingPins.set(String(pin.id), Date.now());
  res.json({ id: String(pin.id), authUrl: plexTv.authUrl(pin.code) });
});

app.get('/api/auth/pin/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!pendingPins.has(id)) throw new PlexError(404, 'Unknown sign-in request');
  const pin = await plexTv.checkPin(id);
  if (!pin.authToken) return void res.json({ done: false });
  pendingPins.delete(id);
  const acct = await addOwnerAccount(pin.authToken);
  res.json({ done: true, account: publicAccount(acct) });
});

async function addOwnerAccount(plexTvToken: string, kind: Account['kind'] = 'owner') {
  const user = await plexTv.user(plexTvToken);
  const serverToken = await serverTokenFor(plexTvToken);
  return upsertAccount({
    name: user.title || user.username || 'Plex account',
    kind,
    thumb: user.thumb,
    plexTvToken,
    serverToken,
    uuid: user.uuid,
  });
}

app.post('/api/accounts/token', async (req, res) => {
  const token = String(req.body?.token ?? '').trim();
  const name = String(req.body?.name ?? '').trim();
  if (!token) throw new PlexError(400, 'Token is required');
  let acct: Account;
  try {
    acct = await addOwnerAccount(token, 'token');
  } catch (e) {
    // Not a plex.tv token (or plex.tv unreachable): accept it if the server itself takes it.
    if (!cfg.serverUrl) throw e;
    await new Pms(cfg.serverUrl, token).get('/playlists');
    acct = upsertAccount({ name: name || 'Token account', kind: 'token', serverToken: token });
  }
  if (name) {
    acct.name = name;
    saveConfig();
  }
  res.json(publicAccount(acct));
});

function findAccount(id: string) {
  const a = cfg.accounts.find((x) => x.id === id);
  if (!a) throw new PlexError(404, 'Account not found');
  return a;
}

app.patch('/api/accounts/:id', (req, res) => {
  const a = findAccount(String(req.params.id));
  const name = String(req.body?.name ?? '').trim();
  if (name) a.name = name;
  saveConfig();
  res.json(publicAccount(a));
});

app.delete('/api/accounts/:id', (req, res) => {
  const a = findAccount(String(req.params.id));
  cfg.accounts = cfg.accounts.filter((x) => x.id !== a.id);
  saveConfig();
  res.json({ ok: true });
});

app.get('/api/accounts/:id/home-users', async (req, res) => {
  const a = findAccount(String(req.params.id));
  if (!a.plexTvToken) throw new PlexError(400, 'This account was added with a server token only, so it cannot list Home users.');
  const users = await plexTv.homeUsers(a.plexTvToken);
  res.json(
    users
      .filter((u) => u.uuid !== a.uuid)
      .map((u) => ({ ...u, addedAs: cfg.accounts.find((x) => x.uuid === u.uuid)?.id })),
  );
});

app.post('/api/accounts/:id/home-users/:uuid', async (req, res) => {
  const owner = findAccount(String(req.params.id));
  if (!owner.plexTvToken) throw new PlexError(400, 'Owner account has no plex.tv token');
  const users = await plexTv.homeUsers(owner.plexTvToken);
  const u = users.find((x) => x.uuid === req.params.uuid);
  if (!u) throw new PlexError(404, 'Home user not found');
  const pin = req.body?.pin ? String(req.body.pin) : undefined;
  let userToken: string;
  try {
    userToken = await plexTv.switchHomeUser(owner.plexTvToken, u, pin);
  } catch (e) {
    if (e instanceof PlexError && (e.status === 401 || e.status === 403)) {
      throw new PlexError(401, u.protected ? 'Wrong PIN for that Home user.' : e.message);
    }
    throw e;
  }
  const serverToken = await serverTokenFor(userToken);
  const acct = upsertAccount({
    name: u.title,
    kind: 'home',
    thumb: u.thumb,
    plexTvToken: userToken,
    serverToken,
    uuid: u.uuid,
    parentId: owner.id,
  });
  res.json(publicAccount(acct));
});

// ---------------------------------------------------------------- per-account Plex API

const acctRouter = express.Router({ mergeParams: true });
app.use('/api/a/:acct', (req, res, next) => {
  const a = findAccount(String(req.params.acct));
  if (!cfg.serverUrl) throw new PlexError(400, 'Set the Plex server URL first (Accounts page).');
  res.locals.pms = new Pms(cfg.serverUrl, a.serverToken);
  next();
}, acctRouter);

const pms = (res: Response): Pms => res.locals.pms;
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

async function inChunks(ids: string[], size: number, fn: (chunk: string[]) => Promise<unknown>) {
  for (let i = 0; i < ids.length; i += size) await fn(ids.slice(i, i + size));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// --- playlists

acctRouter.get('/playlists', async (_req, res) => {
  const j = await pms(res).get('/playlists');
  res.json((j?.MediaContainer?.Metadata ?? []).map(normPlaylist));
});

acctRouter.post('/playlists', async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const ratingKeys = keys(req.body?.ratingKeys);
  if (!title) throw new PlexError(400, 'Title is required');
  if (!ratingKeys.length) throw new PlexError(400, 'Plex needs at least one item to create a playlist');
  const p = pms(res);
  const type = req.body?.type || playlistTypeFor(String(req.body?.itemType ?? 'movie'));
  const first = ratingKeys.slice(0, 100);
  const j = await p.post('/playlists', { type, title, smart: 0, uri: await p.libraryUri(first) });
  const created = j?.MediaContainer?.Metadata?.[0];
  if (!created) throw new PlexError(502, 'Plex did not return the new playlist');
  await inChunks(ratingKeys.slice(100), 100, async (c) => p.put(`/playlists/${created.ratingKey}/items`, { uri: await p.libraryUri(c) }));
  res.json(normPlaylist(created));
});

acctRouter.get('/playlists/:id', async (req, res) => {
  const p = pms(res);
  const [meta, { items }] = await Promise.all([
    p.get(`/playlists/${req.params.id}`),
    p.getAll(`/playlists/${req.params.id}/items`),
  ]);
  const pl = meta?.MediaContainer?.Metadata?.[0];
  if (!pl) throw new PlexError(404, 'Playlist not found');
  res.json({ playlist: normPlaylist(pl), items: items.map(normItem) });
});

acctRouter.put('/playlists/:id', async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) throw new PlexError(400, 'Title is required');
  await pms(res).put(`/playlists/${req.params.id}`, { title });
  res.json({ ok: true });
});

acctRouter.delete('/playlists/:id', async (req, res) => {
  await pms(res).del(`/playlists/${req.params.id}`);
  res.json({ ok: true });
});

acctRouter.post('/playlists/:id/items', async (req, res) => {
  const p = pms(res);
  const ratingKeys = keys(req.body?.ratingKeys);
  await inChunks(ratingKeys, 100, async (c) => p.put(`/playlists/${req.params.id}/items`, { uri: await p.libraryUri(c) }));
  res.json({ ok: true, added: ratingKeys.length });
});

/** Apply a staged edit: remove items, then reorder with the fewest moves. */
acctRouter.post('/playlists/:id/apply', async (req, res) => {
  const p = pms(res);
  const id = req.params.id;
  const remove = new Set(keys(req.body?.remove));
  const order = keys(req.body?.order);

  const { items } = await p.getAll(`/playlists/${id}/items`);
  const current = items.map((m: any) => String(m.playlistItemID));
  for (const pid of current) if (remove.has(pid)) await p.del(`/playlists/${id}/items/${pid}`);

  const remaining = current.filter((pid) => !remove.has(pid));
  const known = new Set(remaining);
  const target = order.filter((x) => known.has(x));
  const targetSet = new Set(target);
  target.push(...remaining.filter((x) => !targetSet.has(x))); // anything the client didn't know about stays at the end
  const moves = planMoves(remaining, target);
  for (const m of moves) await p.put(`/playlists/${id}/items/${m.id}/move`, { after: m.after ?? undefined });

  const after = await p.getAll(`/playlists/${id}/items`);
  res.json({ removed: remove.size, moves: moves.length, items: after.items.map(normItem) });
});

/** Every regular playlist with the items it holds, for "which playlists is this in?". */
acctRouter.get('/playlist-index', async (_req, res) => {
  const p = pms(res);
  const j = await p.get('/playlists');
  const lists = (j?.MediaContainer?.Metadata ?? []).map(normPlaylist).filter((x: any) => !x.smart);
  const index = await mapLimit(lists, 6, async (pl: any) => {
    const { items } = await p.getAll(`/playlists/${pl.ratingKey}/items`);
    return {
      ...pl,
      entries: items.map((m: any) => ({
        rk: String(m.ratingKey),
        pid: String(m.playlistItemID),
        gk: m.grandparentRatingKey ? String(m.grandparentRatingKey) : undefined,
        pk: m.parentRatingKey ? String(m.parentRatingKey) : undefined,
      })),
    };
  });
  res.json(index);
});

acctRouter.post('/playlists/:id/remove', async (req, res) => {
  const p = pms(res);
  for (const pid of keys(req.body?.playlistItemIDs)) await p.del(`/playlists/${req.params.id}/items/${pid}`);
  res.json({ ok: true });
});

// --- libraries & collections

acctRouter.get('/libraries', async (_req, res) => {
  const j = await pms(res).get('/library/sections');
  res.json((j?.MediaContainer?.Directory ?? []).map((d: any) => ({ key: String(d.key), title: d.title, type: d.type })));
});

acctRouter.get('/libraries/:sec/collections', async (req, res) => {
  const { items } = await pms(res).getAll(`/library/sections/${req.params.sec}/collections`);
  res.json(items.map(normCollection));
});

acctRouter.get('/collections/:id', async (req, res) => {
  const p = pms(res);
  const [meta, { items }] = await Promise.all([
    p.get(`/library/metadata/${req.params.id}`),
    p.getAll(`/library/collections/${req.params.id}/children`),
  ]);
  const c = meta?.MediaContainer?.Metadata?.[0];
  if (!c) throw new PlexError(404, 'Collection not found');
  res.json({ collection: normCollection(c), items: items.map(normItem) });
});

acctRouter.post('/collections', async (req, res) => {
  const p = pms(res);
  const title = String(req.body?.title ?? '').trim();
  const sectionId = String(req.body?.sectionId ?? '');
  const ratingKeys = keys(req.body?.ratingKeys);
  if (!title || !sectionId) throw new PlexError(400, 'Title and library are required');
  if (!ratingKeys.length) throw new PlexError(400, 'Plex needs at least one item to create a collection');
  const type = TYPE_NUM[String(req.body?.itemType ?? 'movie')] ?? 1;
  const j = await p.post('/library/collections', { type, title, smart: 0, sectionId, uri: await p.libraryUri(ratingKeys.slice(0, 100)) });
  const created = j?.MediaContainer?.Metadata?.[0];
  if (!created) throw new PlexError(502, 'Plex did not return the new collection');
  await inChunks(ratingKeys.slice(100), 100, async (c) => p.put(`/library/collections/${created.ratingKey}/items`, { uri: await p.libraryUri(c) }));
  res.json(normCollection(created));
});

acctRouter.put('/collections/:id', async (req, res) => {
  const p = pms(res);
  const title = String(req.body?.title ?? '').trim();
  if (!title) throw new PlexError(400, 'Title is required');
  const meta = await p.get(`/library/metadata/${req.params.id}`);
  const sec = meta?.MediaContainer?.Metadata?.[0]?.librarySectionID ?? meta?.MediaContainer?.librarySectionID;
  await p.put(`/library/sections/${sec}/all`, { type: 18, id: String(req.params.id), 'title.value': title, 'title.locked': 1 });
  res.json({ ok: true });
});

acctRouter.delete('/collections/:id', async (req, res) => {
  await pms(res).del(`/library/collections/${req.params.id}`);
  res.json({ ok: true });
});

acctRouter.post('/collections/:id/items', async (req, res) => {
  const p = pms(res);
  const ratingKeys = keys(req.body?.ratingKeys);
  await inChunks(ratingKeys, 100, async (c) => p.put(`/library/collections/${req.params.id}/items`, { uri: await p.libraryUri(c) }));
  res.json({ ok: true, added: ratingKeys.length });
});

acctRouter.post('/collections/:id/apply', async (req, res) => {
  const p = pms(res);
  const id = req.params.id;
  const remove = new Set(keys(req.body?.remove));
  const order = keys(req.body?.order);

  for (const rk of remove) await p.del(`/library/collections/${id}/items/${rk}`);

  let moves = 0;
  if (order.length) {
    await p.put(`/library/metadata/${id}/prefs`, { collectionSort: 2 }); // 2 = custom order
    const { items } = await p.getAll(`/library/collections/${id}/children`);
    const current = items.map((m: any) => String(m.ratingKey));
    const known = new Set(current);
    const target = order.filter((x) => known.has(x));
    const targetSet = new Set(target);
    target.push(...current.filter((x) => !targetSet.has(x)));
    const plan = planMoves(current, target);
    for (const m of plan) await p.put(`/library/collections/${id}/items/${m.id}/move`, { after: m.after ?? undefined });
    moves = plan.length;
  }
  const after = await p.getAll(`/library/collections/${id}/children`);
  res.json({ removed: remove.size, moves, items: after.items.map(normItem) });
});

// --- search, metadata, artwork

acctRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return void res.json([]);
  const j = await pms(res).get('/hubs/search', { query: q, limit: 30, includeCollections: 1, includeExternalMedia: 0 });
  const hubs = (j?.MediaContainer?.Hub ?? [])
    .filter((h: any) => h.Metadata?.length && h.type !== 'genre' && h.type !== 'actor' && h.type !== 'director')
    .map((h: any) => ({ type: h.type, title: h.title, items: h.Metadata.map(normItem) }));
  res.json(hubs);
});

// --- library browsing

const SECTION_ITEM_TYPE: Record<string, number> = { movie: 1, show: 2, artist: 8, photo: 13 };
const SORT_FIELD: Record<string, string> = {
  title: 'titleSort', year: 'year', added: 'addedAt', released: 'originallyAvailableAt', rating: 'audienceRating', viewed: 'lastViewedAt',
};

async function sectionType(p: Pms, sec: string): Promise<string> {
  const j = await p.get('/library/sections');
  const d = (j?.MediaContainer?.Directory ?? []).find((x: any) => String(x.key) === sec);
  if (!d) throw new PlexError(404, 'Library not found');
  return d.type;
}

acctRouter.get('/libraries/:sec/items', async (req, res) => {
  const p = pms(res);
  const sec = String(req.params.sec);
  const q = req.query as Record<string, string | undefined>;
  const type = SECTION_ITEM_TYPE[await sectionType(p, sec)] ?? 1;
  const start = Math.max(0, Number(q.start) || 0);
  const size = Math.min(200, Math.max(1, Number(q.size) || 100));
  const sortField = SORT_FIELD[q.sort ?? 'title'] ?? 'titleSort';
  const params: Record<string, string | number | undefined> = {
    type,
    sort: `${sortField}:${q.dir === 'desc' ? 'desc' : 'asc'}`,
    'X-Plex-Container-Start': start,
    'X-Plex-Container-Size': size,
    title: q.q?.trim() || undefined,
    unwatched: q.unwatched === '1' ? 1 : undefined,
    genre: q.genre || undefined,
    // Plex filter operators: "year>>" = greater than, "year<<" = less than.
    'year>>': q.yearMin ? Number(q.yearMin) - 1 : undefined,
    'year<<': q.yearMax ? Number(q.yearMax) + 1 : undefined,
  };
  const path = q.letter
    ? `/library/sections/${sec}/firstCharacter/${encodeURIComponent(q.letter)}`
    : `/library/sections/${sec}/all`;
  const j = await p.get(path, params);
  const mc = j?.MediaContainer ?? {};
  const items = (mc.Metadata ?? []).map(normItem);
  res.json({ total: Number(mc.totalSize ?? mc.size ?? items.length), start, items });
});

acctRouter.get('/libraries/:sec/genres', async (req, res) => {
  const p = pms(res);
  const type = SECTION_ITEM_TYPE[await sectionType(p, String(req.params.sec))] ?? 1;
  const j = await p.get(`/library/sections/${req.params.sec}/genre`, { type });
  res.json((j?.MediaContainer?.Directory ?? []).map((d: any) => ({ key: String(d.key), title: d.title })));
});

acctRouter.get('/libraries/:sec/letters', async (req, res) => {
  const p = pms(res);
  const type = SECTION_ITEM_TYPE[await sectionType(p, String(req.params.sec))] ?? 1;
  const j = await p.get(`/library/sections/${req.params.sec}/firstCharacter`, { type });
  res.json((j?.MediaContainer?.Directory ?? []).map((d: any) => ({ key: String(d.key ?? d.title), title: d.title, size: Number(d.size ?? 0) })));
});

acctRouter.get('/items/:rk', async (req, res) => {
  const j = await pms(res).get(`/library/metadata/${req.params.rk}`);
  const m = j?.MediaContainer?.Metadata?.[0];
  if (!m) throw new PlexError(404, 'Title not found');
  res.json({
    ...normItem(m),
    summary: m.summary as string | undefined,
    collections: ((m.Collection ?? []) as any[]).map((c) => String(c.tag)),
    librarySectionID: String(m.librarySectionID ?? j?.MediaContainer?.librarySectionID ?? ''),
  });
});

acctRouter.get('/items/:rk/children', async (req, res) => {
  const { items } = await pms(res).getAll(`/library/metadata/${req.params.rk}/children`);
  res.json(items.map(normItem));
});

// --- artwork (posters/thumbnails and background art) for titles, collections and playlists

const artKind = (k: unknown) => {
  if (k !== 'poster' && k !== 'art') throw new PlexError(400, 'Artwork kind must be poster or art');
  return k as 'poster' | 'art';
};
const listPath = (rk: string, kind: 'poster' | 'art') => `/library/metadata/${rk}/${kind === 'poster' ? 'posters' : 'arts'}`;
const rkParam = (v: unknown) => {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new PlexError(400, 'Bad item id');
  return s;
};

acctRouter.get('/art/:rk/:kind', async (req, res) => {
  const rk = rkParam(req.params.rk);
  const j = await pms(res).get(listPath(rk, artKind(req.params.kind)));
  res.json(
    (j?.MediaContainer?.Metadata ?? []).map((m: any) => ({
      key: String(m.key ?? m.ratingKey),
      thumb: m.thumb as string | undefined,
      selected: !!m.selected,
      provider: m.provider as string | undefined,
    })),
  );
});

acctRouter.post('/art/:rk/:kind/select', async (req, res) => {
  const rk = rkParam(req.params.rk);
  const kind = artKind(req.params.kind);
  const url = String(req.body?.url ?? '');
  if (!url) throw new PlexError(400, 'Missing artwork key');
  await pms(res).put(`/library/metadata/${rk}/${kind}`, { url });
  res.json({ ok: true });
});

acctRouter.post('/art/:rk/:kind/url', async (req, res) => {
  const rk = rkParam(req.params.rk);
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new PlexError(400, 'Enter an http(s) image URL');
  await pms(res).post(listPath(rk, artKind(req.params.kind)), { url });
  res.json({ ok: true });
});

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
acctRouter.post(
  '/art/:rk/:kind/upload',
  express.raw({ type: IMAGE_TYPES, limit: '20mb' }),
  async (req, res) => {
    const rk = rkParam(req.params.rk);
    const kind = artKind(req.params.kind);
    const type = String(req.headers['content-type'] ?? '').split(';')[0];
    if (!IMAGE_TYPES.includes(type) || !Buffer.isBuffer(req.body) || !req.body.length) {
      throw new PlexError(400, 'Upload a JPEG, PNG or WebP image (max 20 MB)');
    }
    await pms(res).upload(listPath(rk, kind), req.body, type);
    res.json({ ok: true });
  },
);

acctRouter.get('/thumb', async (req, res) => {
  const src = String(req.query.path ?? '');
  if (!/^\/(library|playlists|photo)\//.test(src)) throw new PlexError(400, 'Bad image path');
  const w = Math.min(Number(req.query.w) || 80, 600);
  const h = Math.min(Number(req.query.h) || 120, 900);
  const r = await pms(res).raw('/photo/:/transcode', { url: src, width: w, height: h, minSize: 1, upscale: 1 });
  if (!r.ok) return void res.status(r.status).end();
  res.setHeader('Content-Type', r.headers.get('content-type') ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(Buffer.from(await r.arrayBuffer()));
});

// ---------------------------------------------------------------- static client & errors

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof PlexError ? err.status : 500;
  if (status >= 500) console.error(err);
  // Upstream 401s mean a Plex token was refused, not that the app session expired.
  const code = err instanceof PlexError && (status === 401 || status === 403) ? 'PLEX_AUTH' : undefined;
  res.status(status).json({ error: err?.message ?? 'Server error', code });
});

app.listen(PORT, () => {
  console.log(`Plex Playlist Manager listening on http://localhost:${PORT}`);
  if (!APP_PASSWORD) console.log('APP_PASSWORD is not set: anyone who can reach this port can manage your Plex playlists.');
});
