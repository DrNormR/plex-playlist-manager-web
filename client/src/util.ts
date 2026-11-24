import type { Item } from './types';

export function fmtDuration(ms?: number) {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
/** Sort title ignoring leading articles, the way Plex does. */
export const sortTitle = (s: string) => s.replace(/^(the|a|an)\s+/i, '');
export const cmpText = (a = '', b = '') => collator.compare(sortTitle(a), sortTitle(b));

export type SortKey =
  | 'title' | 'title-desc' | 'year' | 'year-desc' | 'released' | 'released-desc'
  | 'episode' | 'added' | 'added-desc' | 'duration' | 'duration-desc' | 'unwatched-first' | 'shuffle' | 'reverse';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title A → Z' },
  { key: 'title-desc', label: 'Title Z → A' },
  { key: 'year', label: 'Year, oldest first' },
  { key: 'year-desc', label: 'Year, newest first' },
  { key: 'released', label: 'Release date, oldest first' },
  { key: 'released-desc', label: 'Release date, newest first' },
  { key: 'episode', label: 'Show → season → episode' },
  { key: 'added', label: 'Date added to library, oldest first' },
  { key: 'added-desc', label: 'Date added to library, newest first' },
  { key: 'duration', label: 'Shortest first' },
  { key: 'duration-desc', label: 'Longest first' },
  { key: 'unwatched-first', label: 'Unwatched first' },
  { key: 'reverse', label: 'Reverse current order' },
  { key: 'shuffle', label: 'Shuffle' },
];

export function sortItems(items: Item[], key: SortKey): Item[] {
  const l = [...items];
  const num = (v: number | undefined, fallback: number) => (v === undefined || v === null ? fallback : v);
  switch (key) {
    case 'title': return l.sort((a, b) => cmpText(a.displayTitle, b.displayTitle));
    case 'title-desc': return l.sort((a, b) => cmpText(b.displayTitle, a.displayTitle));
    case 'year': return l.sort((a, b) => num(a.year, 9999) - num(b.year, 9999) || cmpText(a.displayTitle, b.displayTitle));
    case 'year-desc': return l.sort((a, b) => num(b.year, 0) - num(a.year, 0) || cmpText(a.displayTitle, b.displayTitle));
    case 'released': return l.sort((a, b) => (a.originallyAvailableAt ?? '9999').localeCompare(b.originallyAvailableAt ?? '9999'));
    case 'released-desc': return l.sort((a, b) => (b.originallyAvailableAt ?? '').localeCompare(a.originallyAvailableAt ?? ''));
    case 'episode':
      return l.sort(
        (a, b) =>
          cmpText(a.grandparentTitle ?? a.parentTitle ?? a.title, b.grandparentTitle ?? b.parentTitle ?? b.title) ||
          num(a.parentIndex, 0) - num(b.parentIndex, 0) ||
          num(a.index, 0) - num(b.index, 0),
      );
    case 'added': return l.sort((a, b) => num(a.addedAt, 0) - num(b.addedAt, 0));
    case 'added-desc': return l.sort((a, b) => num(b.addedAt, 0) - num(a.addedAt, 0));
    case 'duration': return l.sort((a, b) => num(a.duration, 0) - num(b.duration, 0));
    case 'duration-desc': return l.sort((a, b) => num(b.duration, 0) - num(a.duration, 0));
    case 'unwatched-first': return l.sort((a, b) => (a.viewCount ? 1 : 0) - (b.viewCount ? 1 : 0));
    case 'reverse': return l.reverse();
    case 'shuffle':
      for (let i = l.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
      }
      return l;
  }
}

export const TYPE_LABEL: Record<string, string> = {
  movie: 'Movie', show: 'Show', season: 'Season', episode: 'Episode',
  artist: 'Artist', album: 'Album', track: 'Track', photo: 'Photo', collection: 'Collection', playlist: 'Playlist',
};

export function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
