import { useState } from 'react';
import { api } from '../api';
import type { Item } from '../types';

/** What to add when a show/season (or artist/album) goes into a playlist. */
export type AddMode = 'first' | 'next' | 'all';

const KEY = 'ppm.showAddMode';
export const getAddMode = (): AddMode => {
  const v = localStorage.getItem(KEY);
  return v === 'next' || v === 'all' ? v : 'first';
};

export function useAddMode(): [AddMode, (m: AddMode) => void] {
  const [mode, setMode] = useState<AddMode>(getAddMode);
  return [
    mode,
    (m) => {
      localStorage.setItem(KEY, m);
      setMode(m);
    },
  ];
}

const GROUPS = ['show', 'season', 'artist', 'album'];
export const hasGroups = (items: Pick<Item, 'type'>[]) => items.some((i) => GROUPS.includes(i.type));

/**
 * Turn the picked items into the ratingKeys to add. Shows/seasons become their
 * first (or next unwatched) episode unless mode is 'all'. `acctId` matters for
 * "next unwatched", which uses that account's watch history.
 */
export async function resolveForAdd(acctId: string, items: Pick<Item, 'ratingKey' | 'type'>[], mode: AddMode) {
  if (mode === 'all' || !hasGroups(items)) {
    return { keys: items.map((i) => i.ratingKey), itemType: items[0]?.type ?? 'movie', skipped: 0 };
  }
  const map = await api.episodesFor(acctId, items.map((i) => ({ ratingKey: i.ratingKey, type: i.type })), mode);
  const keys: string[] = [];
  let skipped = 0;
  for (const i of items) {
    const hit = map[i.ratingKey];
    if (hit) keys.push(hit.ratingKey);
    else skipped++;
  }
  const leafType = items.some((i) => i.type === 'artist' || i.type === 'album') ? 'track' : 'episode';
  return { keys: [...new Set(keys)], itemType: hasGroups(items) ? leafType : (items[0]?.type ?? 'movie'), skipped };
}

export function AddModeSelect({ mode, onChange, compact }: { mode: AddMode; onChange: (m: AddMode) => void; compact?: boolean }) {
  return (
    <label className={`add-mode ${compact ? 'compact' : ''}`} title="What to add when you add a whole show or season to a playlist">
      {!compact && <span>For shows add</span>}
      <select value={mode} onChange={(e) => onChange(e.target.value as AddMode)} aria-label="What to add for shows">
        <option value="first">First episode</option>
        <option value="next">Next unwatched episode</option>
        <option value="all">All episodes</option>
      </select>
    </label>
  );
}
