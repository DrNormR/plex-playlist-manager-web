import { getConfig } from './config.js';

export class PlexError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const PRODUCT = 'Plex Playlist Manager';
const VERSION = '2.0.0';

export function plexHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': getConfig().clientId,
    'X-Plex-Platform': 'Web',
    'X-Plex-Device': 'Web',
    'X-Plex-Device-Name': PRODUCT,
  };
  if (token) h['X-Plex-Token'] = token;
  return h;
}

interface ReqOpts {
  method?: string;
  token?: string;
  timeoutMs?: number;
}

export async function rawRequest(url: string, opts: ReqOpts = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  try {
    return await fetch(url, {
      method,
      headers: plexHeaders(opts.token),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
  } catch (e: any) {
    throw new PlexError(502, `Could not reach ${new URL(url).host}: ${e?.cause?.code ?? e?.message ?? e}`);
  }
}

async function request<T = any>(url: string, opts: ReqOpts = {}): Promise<T> {
  const res = await rawRequest(url, opts);
  const text = await res.text();
  if (!res.ok) {
    const detail = text && !text.trimStart().startsWith('<') ? ` – ${text.slice(0, 200)}` : '';
    throw new PlexError(res.status, `${opts.method ?? 'GET'} ${new URL(url).pathname} failed: ${res.status} ${res.statusText}${detail}`);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Minimal attribute extraction for plex.tv endpoints that only speak XML. */
function xmlElements(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
  for (const m of xml.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = decodeXml(a[2]);
    out.push(attrs);
  }
  return out;
}
const decodeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------------------------------------------------------------- plex.tv

const TV = 'https://plex.tv';

export interface PlexTvUser {
  id: number;
  uuid: string;
  username?: string;
  title?: string;
  thumb?: string;
}

export interface HomeUser {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  admin: boolean;
  restricted: boolean;
  protected: boolean;
}

interface Resource {
  name: string;
  clientIdentifier: string;
  provides: string;
  accessToken?: string;
  owned?: boolean;
}

export const plexTv = {
  createPin: () => request<{ id: number; code: string }>(`${TV}/api/v2/pins?strong=true`, { method: 'POST' }),

  checkPin: (id: string) => request<{ authToken: string | null }>(`${TV}/api/v2/pins/${encodeURIComponent(id)}`),

  authUrl: (code: string) =>
    'https://app.plex.tv/auth#?' +
    new URLSearchParams({
      clientID: getConfig().clientId,
      code,
      'context[device][product]': PRODUCT,
    }).toString(),

  user: (token: string) => request<PlexTvUser>(`${TV}/api/v2/user`, { token }),

  async homeUsers(token: string): Promise<HomeUser[]> {
    let raw: any;
    try {
      raw = await request<any>(`${TV}/api/v2/home/users`, { token });
    } catch (e) {
      if (!(e instanceof PlexError) || e.status !== 404) throw e;
      raw = await request<any>(`${TV}/api/home/users`, { token });
    }
    const list: any[] =
      typeof raw === 'string' ? xmlElements(raw, 'User') : Array.isArray(raw) ? raw : (raw?.users ?? raw?.MediaContainer?.User ?? []);
    const bool = (v: any) => v === true || v === 1 || v === '1' || v === 'true';
    return list.map((u) => ({
      id: Number(u.id),
      uuid: u.uuid,
      title: u.title || u.username || u.friendlyName || 'User',
      thumb: u.thumb,
      admin: bool(u.admin),
      restricted: bool(u.restricted),
      protected: bool(u.protected),
    }));
  },

  /** Switch to a Home user and return that user's plex.tv token. */
  async switchHomeUser(token: string, user: { uuid: string; id: number }, pin?: string): Promise<string> {
    const q = pin ? `?pin=${encodeURIComponent(pin)}` : '';
    let raw: any;
    try {
      raw = await request<any>(`${TV}/api/v2/home/users/${user.uuid}/switch${q}`, { method: 'POST', token });
    } catch (e) {
      if (!(e instanceof PlexError) || e.status !== 404) throw e;
      raw = await request<any>(`${TV}/api/home/users/${user.id}/switch${q}`, { method: 'POST', token });
    }
    const obj = typeof raw === 'string' ? (xmlElements(raw, 'user')[0] ?? {}) : raw;
    const t = obj.authToken || obj.authenticationToken;
    if (!t) throw new PlexError(502, 'plex.tv did not return a token for that Home user');
    return t;
  },

  resources: (token: string) => request<Resource[]>(`${TV}/api/v2/resources?includeHttps=1&includeRelay=0`, { token }),
};

// ---------------------------------------------------------------- Plex Media Server

const machineIds = new Map<string, { id: string; name?: string }>();

export async function serverIdentity(serverUrl: string): Promise<{ id: string; name?: string }> {
  const hit = machineIds.get(serverUrl);
  if (hit) return hit;
  const j = await request<any>(new URL('/identity', serverUrl).toString(), { timeoutMs: 8000 });
  const id = j?.MediaContainer?.machineIdentifier;
  if (!id) throw new PlexError(502, `${serverUrl} did not answer like a Plex server`);
  const v = { id, name: undefined as string | undefined };
  machineIds.set(serverUrl, v);
  return v;
}

/** Find the token a plex.tv account should use against the configured server. */
export async function serverTokenFor(plexTvToken: string): Promise<string> {
  const { serverUrl } = getConfig();
  if (!serverUrl) throw new PlexError(400, 'Set the Plex server URL first (Accounts page).');
  const { id } = await serverIdentity(serverUrl);
  const resources = await plexTv.resources(plexTvToken);
  const r = resources.find((x) => x.clientIdentifier === id);
  if (!r) throw new PlexError(403, `This Plex account has no access to the server at ${serverUrl}.`);
  return r.accessToken || plexTvToken;
}

export class Pms {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  url(path: string, params: Record<string, string | number | undefined> = {}) {
    const u = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  get<T = any>(path: string, params?: Record<string, string | number | undefined>) {
    return request<T>(this.url(path, params), { token: this.token });
  }
  put<T = any>(path: string, params?: Record<string, string | number | undefined>) {
    return request<T>(this.url(path, params), { method: 'PUT', token: this.token });
  }
  post<T = any>(path: string, params?: Record<string, string | number | undefined>) {
    return request<T>(this.url(path, params), { method: 'POST', token: this.token });
  }
  del<T = any>(path: string, params?: Record<string, string | number | undefined>) {
    return request<T>(this.url(path, params), { method: 'DELETE', token: this.token });
  }
  raw(path: string, params?: Record<string, string | number | undefined>) {
    return rawRequest(this.url(path, params), { token: this.token });
  }

  /** Fetch every Metadata entry from a container endpoint, paging through large ones. */
  async getAll(path: string, params: Record<string, string | number> = {}): Promise<{ container: any; items: any[] }> {
    const size = 500;
    const items: any[] = [];
    let container: any;
    for (let start = 0; ; start += size) {
      const j = await this.get(path, { ...params, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size });
      const mc = j?.MediaContainer ?? {};
      container ??= mc;
      const page: any[] = mc.Metadata ?? [];
      items.push(...page);
      const total = Number(mc.totalSize ?? mc.leafCount ?? NaN);
      if (page.length < size || (Number.isFinite(total) && items.length >= total)) break;
    }
    return { container, items };
  }

  async libraryUri(ratingKeys: string[]) {
    const { id } = await serverIdentity(this.baseUrl);
    return `server://${id}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`;
  }
}

// ---------------------------------------------------------------- normalised shapes

export interface Item {
  ratingKey: string;
  playlistItemID?: string;
  title: string;
  displayTitle: string;
  type: string;
  year?: number;
  library?: string;
  thumb?: string;
  duration?: number;
  viewCount?: number;
  addedAt?: number;
  originallyAvailableAt?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  leafCount?: number;
  /** Show (episodes) or artist (tracks). */
  grandparentKey?: string;
  /** Season (episodes), show (seasons), album (tracks) or artist (albums). */
  parentKey?: string;
}

const pad = (n: unknown) => String(n ?? '?').padStart(2, '0');

export function normItem(m: any): Item {
  const type: string = m.type ?? 'unknown';
  let displayTitle: string = m.title ?? '(untitled)';
  if (type === 'episode') displayTitle = `${m.grandparentTitle} S${pad(m.parentIndex)}E${pad(m.index)} – ${m.title}`;
  else if (type === 'season') displayTitle = `${m.parentTitle} – ${m.title}`;
  else if (type === 'track') displayTitle = `${m.grandparentTitle ?? m.originalTitle ?? ''} – ${m.title}`;
  else if (type === 'album') displayTitle = `${m.parentTitle} – ${m.title}`;
  const thumb = ['episode', 'season', 'track'].includes(type) ? (m.grandparentThumb ?? m.parentThumb ?? m.thumb) : m.thumb;
  return {
    ratingKey: String(m.ratingKey),
    playlistItemID: m.playlistItemID !== undefined ? String(m.playlistItemID) : undefined,
    title: m.title ?? '',
    displayTitle,
    type,
    year: m.year ?? m.parentYear,
    library: m.librarySectionTitle,
    thumb,
    duration: m.duration,
    viewCount: m.viewCount ?? (m.viewedLeafCount !== undefined && m.leafCount ? (m.viewedLeafCount >= m.leafCount ? 1 : 0) : undefined),
    addedAt: m.addedAt,
    originallyAvailableAt: m.originallyAvailableAt,
    grandparentTitle: m.grandparentTitle,
    parentTitle: m.parentTitle,
    parentIndex: m.parentIndex,
    index: m.index,
    leafCount: m.leafCount,
    grandparentKey: m.grandparentRatingKey ? String(m.grandparentRatingKey) : undefined,
    parentKey: m.parentRatingKey ? String(m.parentRatingKey) : undefined,
  };
}

export function normPlaylist(p: any) {
  return {
    ratingKey: String(p.ratingKey),
    title: p.title as string,
    playlistType: p.playlistType as string,
    smart: !!p.smart,
    leafCount: Number(p.leafCount ?? 0),
    duration: p.duration as number | undefined,
    thumb: (p.composite ?? p.thumb) as string | undefined,
    updatedAt: p.updatedAt as number | undefined,
    addedAt: p.addedAt as number | undefined,
  };
}

export function normCollection(c: any) {
  return {
    ratingKey: String(c.ratingKey),
    title: c.title as string,
    smart: !!c.smart,
    leafCount: Number(c.childCount ?? c.leafCount ?? 0),
    thumb: c.thumb as string | undefined,
    subtype: c.subtype as string | undefined,
    collectionSort: c.collectionSort as string | undefined,
    librarySectionID: c.librarySectionID ? String(c.librarySectionID) : undefined,
    updatedAt: c.updatedAt as number | undefined,
  };
}

/** Plex metadata type numbers used when creating collections. */
export const TYPE_NUM: Record<string, number> = {
  movie: 1, show: 2, season: 3, episode: 4, artist: 8, album: 9, track: 10, photo: 13,
};

export function playlistTypeFor(itemType: string): 'video' | 'audio' | 'photo' {
  if (['track', 'album', 'artist'].includes(itemType)) return 'audio';
  if (itemType === 'photo') return 'photo';
  return 'video';
}
