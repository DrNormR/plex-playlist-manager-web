import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, errMsg } from '../api';
import type { IndexedPlaylist, Item } from '../types';

/**
 * Which items each playlist holds, per account. Shared by the Library and Search
 * tabs so the (possibly slow) scan of every playlist only happens once.
 */
const cache = new Map<string, IndexedPlaylist[]>();
const inflight = new Map<string, Promise<IndexedPlaylist[]>>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export function setPlaylistIndex(acct: string, ix: IndexedPlaylist[]) {
  cache.set(acct, ix);
  emit();
}

export function updatePlaylistIndex(acct: string, fn: (ix: IndexedPlaylist[]) => IndexedPlaylist[]) {
  const cur = cache.get(acct);
  if (cur) setPlaylistIndex(acct, fn(cur));
}

export function invalidatePlaylistIndex(acct: string) {
  cache.delete(acct);
  emit();
}

function fetchIndex(acct: string) {
  let p = inflight.get(acct);
  if (!p) {
    p = api.playlistIndex(acct).finally(() => inflight.delete(acct));
    inflight.set(acct, p);
  }
  return p;
}

/** Re-read one playlist after it changed and patch it into the index. */
export async function refreshIndexedPlaylist(acct: string, plId: string) {
  const { playlist, items } = await api.playlist(acct, plId);
  const entries = items.map((i) => ({ rk: i.ratingKey, pid: i.playlistItemID!, gk: i.grandparentKey, pk: i.parentKey }));
  const cur = cache.get(acct);
  if (!cur) return;
  const exists = cur.some((p) => p.ratingKey === plId);
  setPlaylistIndex(
    acct,
    exists ? cur.map((p) => (p.ratingKey === plId ? { ...p, ...playlist, entries } : p)) : [...cur, { ...playlist, entries }],
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getVersion = () => version;

export function usePlaylistIndex(acct: string | undefined, enabled = true) {
  const ver = useSyncExternalStore(subscribe, getVersion);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!acct) return;
      if (!force && cache.has(acct)) return;
      if (force) cache.delete(acct);
      setError('');
      setLoading(true);
      try {
        setPlaylistIndex(acct, await fetchIndex(acct));
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [acct],
  );

  // Load on mount, and again whenever the cached index is invalidated elsewhere.
  useEffect(() => {
    if (enabled && acct && !cache.has(acct)) load();
  }, [enabled, load, acct, ver]);

  return { index: acct ? (cache.get(acct) ?? null) : null, error, loading, reload: () => load(true) };
}

const GROUP_TYPES = ['show', 'season', 'artist', 'album'];

/** Playlist entries that are this item, or (for shows/seasons/artists/albums) its episodes/tracks. */
export function entryMatcher(item: Pick<Item, 'ratingKey' | 'type'>) {
  const group = GROUP_TYPES.includes(item.type);
  return (e: IndexedPlaylist['entries'][number]) =>
    e.rk === item.ratingKey || (group && (e.gk === item.ratingKey || e.pk === item.ratingKey));
}

/** Set of every ratingKey (and parent/grandparent key) that appears in any playlist. */
export function keysInPlaylists(index: IndexedPlaylist[]) {
  const s = new Set<string>();
  for (const p of index) {
    for (const e of p.entries) {
      s.add(e.rk);
      if (e.gk) s.add(e.gk);
      if (e.pk) s.add(e.pk);
    }
  }
  return s;
}

export const isGroupType = (t: string) => GROUP_TYPES.includes(t);
