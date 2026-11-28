import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Item, RecentLibrary, WatchedItem } from '../types';
import { Thumb } from '../components/Thumb';
import { TitlePanel } from '../components/TitlePanel';
import { plural } from '../util';

const pad = (n?: number) => String(n ?? 0).padStart(2, '0');

export function timeAgo(unix?: number) {
  if (!unix) return '';
  const s = Date.now() / 1000 - unix;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 2) return 'yesterday';
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 86400 * 300 ? 'numeric' : undefined });
}

/** A card in a strip: what to show and which item the side panel should open. */
interface Card {
  id: string;
  focus: Item;
  thumb?: string;
  title: string;
  sub?: string;
  note?: string;
  progress?: number;
  square?: boolean;
  wide?: boolean;
  /** Removed from the library: nothing to open. */
  gone?: boolean;
}

function itemSub(i: Item) {
  if (i.type === 'episode') return `S${pad(i.parentIndex)}E${pad(i.index)} · ${i.title}`;
  if (i.type === 'season') return i.title;
  if (i.type === 'track') return i.title;
  if (i.type === 'album') return i.title;
  return i.year ? String(i.year) : '';
}
const itemTitle = (i: Item) => (['episode', 'season', 'track'].includes(i.type) ? (i.grandparentTitle ?? i.parentTitle ?? i.title) : i.type === 'album' ? (i.parentTitle ?? i.title) : i.title);
const isSquare = (i: Item) => ['track', 'album', 'artist'].includes(i.type);

function toCard(i: Item, note?: string): Card {
  return {
    id: i.ratingKey,
    focus: i,
    thumb: i.thumb,
    title: itemTitle(i),
    sub: itemSub(i),
    note,
    progress: i.viewOffset && i.duration ? Math.min(1, i.viewOffset / i.duration) : undefined,
    square: isSquare(i),
  };
}

/** Group a library's recently added episodes by season, like Plex's home screen. */
function addedCards(lib: RecentLibrary): Card[] {
  const out: Card[] = [];
  const seasons = new Map<string, { card: Card; n: number }>();
  for (const i of lib.items) {
    if (i.type === 'episode' && i.parentKey) {
      const g = seasons.get(i.parentKey);
      if (g) {
        g.n++;
        g.card.sub = `${i.parentTitle ?? 'Season'} · ${g.n} new episodes`;
        continue;
      }
      const card = toCard(i, timeAgo(i.addedAt));
      seasons.set(i.parentKey, { card, n: 1 });
      out.push(card);
    } else out.push(toCard(i, timeAgo(i.addedAt)));
  }
  // A season with several new episodes opens the season in the side panel.
  for (const [pk, g] of seasons) {
    if (g.n > 1) {
      const ep = g.card.focus;
      g.card.focus = { ratingKey: pk, type: 'season', title: ep.parentTitle ?? 'Season', displayTitle: `${ep.grandparentTitle} – ${ep.parentTitle}`, thumb: ep.thumb, parentTitle: ep.grandparentTitle, library: ep.library };
    }
  }
  return out;
}

function Strip({ acct, cards, focused, onFocus, empty }: { acct: string; cards: Card[]; focused?: string; onFocus: (i: Item) => void; empty?: string }) {
  if (!cards.length) return <div className="muted small strip-empty">{empty ?? 'Nothing yet.'}</div>;
  return (
    <div className="strip">
      {cards.map((c) => (
        <button key={c.id} className={`strip-card ${focused === c.focus.ratingKey ? 'focused' : ''} ${c.square ? 'sq' : ''}`} onClick={() => !c.gone && onFocus(c.focus)} disabled={c.gone} title={[c.title, c.sub, c.gone && '(removed from the library)'].filter(Boolean).join(' — ')}>
          <div className="strip-poster">
            <Thumb acct={acct} path={c.thumb} w={c.square ? 130 : 110} h={165} square={c.square} />
            {c.progress !== undefined && (
              <div className="progress" aria-label={`${Math.round(c.progress * 100)}% watched`}>
                <div style={{ width: `${Math.max(3, c.progress * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="strip-title ellipsis">{c.title}</div>
          {c.sub && <div className="muted small ellipsis">{c.sub}</div>}
          {c.note && <div className="muted small ellipsis">{c.note}</div>}
        </button>
      ))}
    </div>
  );
}

function remaining(i: Item) {
  if (!i.duration || !i.viewOffset) return '';
  const min = Math.round((i.duration - i.viewOffset) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

export function RecentPage() {
  const { acct } = useApp();
  const acctId = acct!.id;
  const [cont, setCont] = useState<Item[] | null>(null);
  const [watched, setWatched] = useState<WatchedItem[] | null>(null);
  const [added, setAdded] = useState<RecentLibrary[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<Item | null>(null);
  const [watchLib, setWatchLib] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('ppm.recent.hidden') ?? '[]')));

  const load = useCallback(() => {
    const fail = (k: string) => (e: unknown) => setErrors((x) => ({ ...x, [k]: errMsg(e) }));
    setErrors({});
    api.recentContinue(acctId).then(setCont, fail('continue'));
    api.recentWatched(acctId, 120).then(setWatched, fail('watched'));
    api.recentAdded(acctId, 20).then(setAdded, fail('added'));
  }, [acctId]);
  useEffect(load, [load]);

  const toggleHidden = (key: string) => {
    const n = new Set(hidden);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setHidden(n);
    localStorage.setItem('ppm.recent.hidden', JSON.stringify([...n]));
  };

  const inProgress = useMemo(() => (cont ?? []).filter((i) => i.viewOffset), [cont]);
  const upNext = useMemo(() => (cont ?? []).filter((i) => !i.viewOffset), [cont]);
  const watchLibs = useMemo(() => [...new Set((watched ?? []).map((w) => w.library).filter(Boolean))] as string[], [watched]);
  const watchedCards = useMemo(
    () => (watched ?? []).filter((w) => !watchLib || w.library === watchLib).map((w) => ({ ...toCard(w, w.deleted ? `${timeAgo(w.viewedAt)} · removed` : timeAgo(w.viewedAt)), id: `${w.ratingKey}-${w.viewedAt}`, progress: undefined, gone: w.deleted })),
    [watched, watchLib],
  );

  const f = focus?.ratingKey;
  return (
    <div className="split">
      <main className="main recent">
        <div className="recent-head">
          <h2>Recent for {acct!.name}</h2>
          <button onClick={load}>↻ Refresh</button>
        </div>

        <section>
          <h3>In progress {cont && <span className="muted small">{inProgress.length || ''}</span>}</h3>
          {errors.continue && <div className="banner error">{errors.continue}</div>}
          {cont === null && !errors.continue ? (
            <div className="muted small strip-empty">Loading…</div>
          ) : (
            <Strip acct={acctId} focused={f} onFocus={setFocus} cards={inProgress.map((i) => toCard(i, remaining(i)))} empty="Nothing in progress." />
          )}
        </section>

        {upNext.length > 0 && (
          <section>
            <h3>Up next</h3>
            <Strip acct={acctId} focused={f} onFocus={setFocus} cards={upNext.map((i) => toCard(i))} />
          </section>
        )}

        <section>
          <h3>
            Recently watched
            {watchLibs.length > 1 && (
              <select className="small" value={watchLib} onChange={(e) => setWatchLib(e.target.value)} aria-label="Library">
                <option value="">All libraries</option>
                {watchLibs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            )}
          </h3>
          {errors.watched && <div className="banner error">{errors.watched}</div>}
          {watched === null && !errors.watched ? (
            <div className="muted small strip-empty">Loading…</div>
          ) : (
            <Strip acct={acctId} focused={f} onFocus={setFocus} cards={watchedCards} empty="No plays yet." />
          )}
        </section>

        <h3 className="recent-sub">Recently added</h3>
        {errors.added && <div className="banner error">{errors.added}</div>}
        {added === null && !errors.added && <div className="muted small strip-empty">Loading libraries…</div>}
        {added?.map((lib) => (
          <section key={lib.key} className="recent-lib">
            <h4>
              <button className="link" onClick={() => toggleHidden(lib.key)} title={hidden.has(lib.key) ? 'Show' : 'Hide'}>
                {hidden.has(lib.key) ? '▸' : '▾'} {lib.title}
              </button>
              {lib.items[0]?.addedAt && <span className="muted small"> last added {timeAgo(lib.items[0].addedAt)}</span>}
            </h4>
            {!hidden.has(lib.key) &&
              (lib.error ? (
                <div className="banner error">{lib.error}</div>
              ) : (
                <Strip acct={acctId} focused={f} onFocus={setFocus} cards={addedCards(lib)} empty="Nothing added yet." />
              ))}
          </section>
        ))}
        {added && !added.length && <div className="muted">No libraries.</div>}
      </main>

      <aside className="sidebar sidebar-right">
        {focus ? (
          <TitlePanel key={focus.ratingKey} item={focus} onReplaced={(_old, fresh) => setFocus(fresh)} />
        ) : (
          <div className="muted pad">
            Click a title to see its details, add it to playlists, or mark it watched.
            {watched && <div className="small" style={{ marginTop: 8 }}>{plural(watched.length, 'recent play')} loaded.</div>}
          </div>
        )}
      </aside>
    </div>
  );
}
