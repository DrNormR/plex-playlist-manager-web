import type { Account, ArtKind, ArtOption, Collection, HomeUser, IndexedPlaylist, Item, ItemDetails, Library, LibraryPageResult, Playlist, SearchHub } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let onLoginRequired: () => void = () => {};
export const setLoginHandler = (fn: () => void) => (onLoginRequired = fn);

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (data?.code === 'LOGIN') onLoginRequired();
    throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`, data?.code);
  }
  return data as T;
}

const a = (acct: string) => `/api/a/${encodeURIComponent(acct)}`;

export const api = {
  session: () => call<{ authRequired: boolean; authenticated: boolean }>('GET', '/api/session'),
  login: (password: string) => call('POST', '/api/login', { password }),
  logout: () => call('POST', '/api/logout'),

  settings: () => call<{ serverUrl: string; reachable: boolean; lockedByEnv: boolean }>('GET', '/api/settings'),
  saveSettings: (serverUrl: string) => call<{ serverUrl: string }>('PUT', '/api/settings', { serverUrl }),

  accounts: () => call<Account[]>('GET', '/api/accounts'),
  startPin: () => call<{ id: string; authUrl: string }>('POST', '/api/auth/pin'),
  checkPin: (id: string) => call<{ done: boolean; account?: Account }>('GET', `/api/auth/pin/${id}`),
  addToken: (token: string, name: string) => call<Account>('POST', '/api/accounts/token', { token, name }),
  renameAccount: (id: string, name: string) => call<Account>('PATCH', `/api/accounts/${id}`, { name }),
  removeAccount: (id: string) => call('DELETE', `/api/accounts/${id}`),
  homeUsers: (id: string) => call<HomeUser[]>('GET', `/api/accounts/${id}/home-users`),
  addHomeUser: (id: string, uuid: string, pin?: string) => call<Account>('POST', `/api/accounts/${id}/home-users/${uuid}`, { pin }),

  playlists: (acct: string) => call<Playlist[]>('GET', `${a(acct)}/playlists`),
  playlist: (acct: string, id: string) => call<{ playlist: Playlist; items: Item[] }>('GET', `${a(acct)}/playlists/${id}`),
  createPlaylist: (acct: string, title: string, ratingKeys: string[], itemType: string) =>
    call<Playlist>('POST', `${a(acct)}/playlists`, { title, ratingKeys, itemType }),
  renamePlaylist: (acct: string, id: string, title: string) => call('PUT', `${a(acct)}/playlists/${id}`, { title }),
  deletePlaylist: (acct: string, id: string) => call('DELETE', `${a(acct)}/playlists/${id}`),
  addToPlaylist: (acct: string, id: string, ratingKeys: string[]) => call('POST', `${a(acct)}/playlists/${id}/items`, { ratingKeys }),
  removeFromPlaylist: (acct: string, id: string, playlistItemIDs: string[]) =>
    call('POST', `${a(acct)}/playlists/${id}/remove`, { playlistItemIDs }),
  applyPlaylist: (acct: string, id: string, remove: string[], order: string[]) =>
    call<{ removed: number; moves: number; items: Item[] }>('POST', `${a(acct)}/playlists/${id}/apply`, { remove, order }),
  playlistIndex: (acct: string) => call<IndexedPlaylist[]>('GET', `${a(acct)}/playlist-index`),

  libraries: (acct: string) => call<Library[]>('GET', `${a(acct)}/libraries`),
  collections: (acct: string, sec: string) => call<Collection[]>('GET', `${a(acct)}/libraries/${sec}/collections`),
  collection: (acct: string, id: string) => call<{ collection: Collection; items: Item[] }>('GET', `${a(acct)}/collections/${id}`),
  createCollection: (acct: string, sectionId: string, title: string, ratingKeys: string[], itemType: string) =>
    call<Collection>('POST', `${a(acct)}/collections`, { sectionId, title, ratingKeys, itemType }),
  renameCollection: (acct: string, id: string, title: string) => call('PUT', `${a(acct)}/collections/${id}`, { title }),
  deleteCollection: (acct: string, id: string) => call('DELETE', `${a(acct)}/collections/${id}`),
  addToCollection: (acct: string, id: string, ratingKeys: string[]) => call('POST', `${a(acct)}/collections/${id}/items`, { ratingKeys }),
  applyCollection: (acct: string, id: string, remove: string[], order: string[]) =>
    call<{ removed: number; moves: number; items: Item[] }>('POST', `${a(acct)}/collections/${id}/apply`, { remove, order }),

  search: (acct: string, q: string) => call<SearchHub[]>('GET', `${a(acct)}/search?q=${encodeURIComponent(q)}`),
  item: (acct: string, rk: string) => call<ItemDetails>('GET', `${a(acct)}/items/${rk}`),
  children: (acct: string, rk: string) => call<Item[]>('GET', `${a(acct)}/items/${rk}/children`),
  removeFromCollection: (acct: string, id: string, ratingKey: string) =>
    call('POST', `${a(acct)}/collections/${id}/apply`, { remove: [ratingKey], order: [] }),

  libraryItems: (acct: string, sec: string, params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return call<LibraryPageResult>('GET', `${a(acct)}/libraries/${sec}/items?${qs}`);
  },
  genres: (acct: string, sec: string) => call<{ key: string; title: string }[]>('GET', `${a(acct)}/libraries/${sec}/genres`),
  letters: (acct: string, sec: string) => call<{ key: string; title: string; size: number }[]>('GET', `${a(acct)}/libraries/${sec}/letters`),

  artOptions: (acct: string, rk: string, kind: ArtKind) => call<ArtOption[]>('GET', `${a(acct)}/art/${rk}/${kind}`),
  selectArt: (acct: string, rk: string, kind: ArtKind, url: string) => call('POST', `${a(acct)}/art/${rk}/${kind}/select`, { url }),
  artFromUrl: (acct: string, rk: string, kind: ArtKind, url: string) => call('POST', `${a(acct)}/art/${rk}/${kind}/url`, { url }),
  async uploadArt(acct: string, rk: string, kind: ArtKind, file: File) {
    const res = await fetch(`${a(acct)}/art/${rk}/${kind}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => undefined);
      if (data?.code === 'LOGIN') onLoginRequired();
      throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`, data?.code);
    }
  },
};

export const thumbUrl = (acct: string, path: string | undefined, w = 60, h = 90) =>
  !path ? undefined : /^https?:\/\//i.test(path) ? path : `${a(acct)}/thumb?path=${encodeURIComponent(path)}&w=${w}&h=${h}`;

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
