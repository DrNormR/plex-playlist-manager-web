import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Item, Library } from '../types';
import { Thumb } from '../components/Thumb';
import { TitlePanel } from '../components/TitlePanel';
import { TargetPicker } from '../components/TargetPicker';
import { invalidatePlaylistIndex, isGroupType, keysInPlaylists, refreshIndexedPlaylist, usePlaylistIndex } from '../components/playlistIndex';
import { TYPE_LABEL, cmpText, fmtDuration, plural } from '../util';

const PAGE = 100;
const SORTS = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date added' },
  { key: 'released', label: 'Release date' },
  { key: 'rating', label: 'Rating' },
  { key: 'viewed', label: 'Last watched' },
];
const DRILLABLE = ['show', 'season', 'artist', 'album'];

interface Filters {
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
  unwatched: boolean;
  genre: string;
  yearMin: string;
  yearMax: string;
  letter: string;
}
const NO_FILTERS: Filters = { q: '', sort: 'title', dir: 'asc', unwatched: false, genre: '', yearMin: '', yearMax: '', letter: '' };

interface QuickTarget {
  ratingKey: string;
  title: string;
}

export function LibraryPage() {
  const { acct, notify } = useApp();
  const acctId = acct!.id;
  const [libs, setLibs] = useState<Library[] | null>(null);
  const [libError, setLibError] = useState('');
  const [sec, setSec] = useState(() => localStorage.getItem(`ppm.browse.${acctId}`) ?? '');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [qInput, setQInput] = useState('');
  const [notInPlaylist, setNotInPlaylist] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('ppm.view') as 'list' | 'grid') ?? 'list');
  const [genres, setGenres] = useState<{ key: string; title: string }[]>([]);
  const [letters, setLetters] = useState<{ key: string; title: string; size: number }[]>([]);

  // top-level paged list
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const gen = useRef(0);

  // drill-down (show → season → episode, artist → album → track)
  const [trail, setTrail] = useState<Item[]>([]);
  const [children, setChildren] = useState<Item[] | null>(null);

  const [focus, setFocus] = useState<Item | null>(null);
  const [picked, setPicked] = useState<Map<string, Item>>(new Map());
  const [adding, setAdding] = useState<Item[] | null>(null);
  const [quick, setQuick] = useState<QuickTarget | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(`ppm.quick.${acctId}`) ?? 'null');
    } catch {
      return null;
    }
  });

  const { index } = usePlaylistIndex(acctId);
  const inPlaylists = useMemo(() => (index ? keysInPlaylists(index) : null), [index]);
  const playlistsForQuick = useMemo(
    () => (index ?? []).filter((p) => !p.smart).sort((a, b) => cmpText(a.title, b.title)),
    [index],
  );

  const lib = libs?.find((l) => l.key === sec);

  // ---- libraries
  useEffect(() => {
    api.libraries(acctId).then(
      (l) => {
        const usable = l.filter((x) => x.type !== 'photo');
        setLibs(usable);
        setSec((s) => (usable.some((x) => x.key === s) ? s : (usable[0]?.key ?? '')));
      },
      (e) => setLibError(errMsg(e)),
    );
  }, [acctId]);

  useEffect(() => {
    if (!sec) return;
    localStorage.setItem(`ppm.browse.${acctId}`, sec);
    setFilters(NO_FILTERS);
    setQInput('');
    setTrail([]);
    setFocus(null);
    setPicked(new Map());
    api.genres(acctId, sec).then(setGenres, () => setGenres([]));
    api.letters(acctId, sec).then(setLetters, () => setLetters([]));
  }, [sec, acctId]);

  // debounce the text filter
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput, letter: '' })), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  // ---- paged loading
  const loadPage = useCallback(
    async (start: number) => {
      if (!sec) return;
      const g = gen.current;
      setLoading(true);
      try {
        const r = await api.libraryItems(acctId, sec, {
          start,
          size: PAGE,
          sort: filters.sort,
          dir: filters.dir,
          q: filters.q.trim() || undefined,
          unwatched: filters.unwatched ? 1 : undefined,
          genre: filters.genre || undefined,
          yearMin: filters.yearMin || undefined,
          yearMax: filters.yearMax || undefined,
          letter: filters.letter || undefined,
        });
        if (g !== gen.current) return;
        setTotal(r.total);
        setItems((cur) => (start === 0 ? r.items : [...cur, ...r.items]));
        setListError('');
      } catch (e) {
        if (g === gen.current) setListError(errMsg(e));
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [acctId, sec, filters],
  );

  useEffect(() => {
    gen.current++;
    setItems([]);
    setTotal(0);
    loadPage(0);
  }, [loadPage]);

  const hasMore = items.length < total;
  const sentinel = useRef<HTMLDivElement>(null);
  const sentinelVisible = useRef(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      sentinelVisible.current = e.isIntersecting;
      if (e.isIntersecting && !loading && hasMore && !trail.length) loadPage(items.length);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, hasMore, items.length, loadPage, trail.length]);
  // Keep loading while the end of the list is on screen (e.g. a filter hides most rows).
  useEffect(() => {
    if (!loading && hasMore && sentinelVisible.current && !trail.length) loadPage(items.length);
  }, [loading, hasMore, items.length, loadPage, trail.length]);

  // ---- drill-down
  useEffect(() => {
    const top = trail[trail.length - 1];
    if (!top) return setChildren(null);
    setChildren(null);
    api.children(acctId, top.ratingKey).then(setChildren, (e) => notify(errMsg(e), 'error'));
  }, [trail, acctId, notify]);

  const drill = (i: Item) => {
    setTrail((t) => [...t, i]);
    setFocus(i);
  };

  const baseList = trail.length ? (children ?? []) : items;
  const shown = notInPlaylist && inPlaylists ? baseList.filter((i) => !inPlaylists.has(i.ratingKey)) : baseList;

  // ---- actions
  const togglePick = (i: Item) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(i.ratingKey)) n.delete(i.ratingKey);
      else n.set(i.ratingKey, i);
      return n;
    });

  const rememberQuick = (t: QuickTarget | null) => {
    setQuick(t);
    localStorage.setItem(`ppm.quick.${acctId}`, JSON.stringify(t));
  };

  const quickAdd = async (i: Item) => {
    if (!quick) return;
    try {
      await api.addToPlaylist(acctId, quick.ratingKey, [i.ratingKey]);
      notify(`Added “${i.displayTitle}” to “${quick.title}”`, 'ok');
      refreshIndexedPlaylist(acctId, quick.ratingKey).catch(() => {});
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = !!(filters.q || filters.unwatched || filters.genre || filters.yearMin || filters.yearMax || filters.letter);

  const changeView = (v: 'list' | 'grid') => {
    setView(v);
    localStorage.setItem('ppm.view', v);
  };

  return (
    <div className="split">
      <aside className="sidebar lib-side">
        <div className="side-tools"><strong>Libraries</strong></div>
        {libError && <div className="banner error">{libError}</div>}
        <div className="side-list">
          {libs === null && !libError && <div className="muted pad">Loading…</div>}
          {libs?.map((l) => (
            <div key={l.key} className={`side-item ${sec === l.key ? 'active' : ''}`} onClick={() => setSec(l.key)}>
              <span className="lib-icon">{l.type === 'movie' ? '🎬' : l.type === 'show' ? '📺' : l.type === 'artist' ? '🎵' : '📁'}</span>
              <span className="grow ellipsis">{l.title}</span>
              {sec === l.key && total > 0 && !filtered && <span className="muted small">{total.toLocaleString()}</span>}
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="lib-toolbar">
          {trail.length > 0 ? (
            <div className="crumbs">
              <button className="link" onClick={() => setTrail([])}>{lib?.title ?? 'Library'}</button>
              {trail.map((t, n) => (
                <span key={t.ratingKey}>
                  {' › '}
                  {n === trail.length - 1 ? (
                    <strong>{t.title}</strong>
                  ) : (
                    <button className="link" onClick={() => setTrail(trail.slice(0, n + 1))}>{t.title}</button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <>
              <input className="filter lib-search" placeholder={`Filter ${lib?.title ?? 'library'} by title…`} value={qInput} onChange={(e) => setQInput(e.target.value)} />
              <select value={filters.sort} onChange={(e) => setF({ sort: e.target.value, dir: e.target.value === 'title' ? 'asc' : 'desc' })} aria-label="Sort by">
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <button className="icon" onClick={() => setF({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })} title="Reverse sort">
                {filters.dir === 'asc' ? '↑' : '↓'}
              </button>
              {genres.length > 0 && (
                <select value={filters.genre} onChange={(e) => setF({ genre: e.target.value })} aria-label="Genre">
                  <option value="">All genres</option>
                  {genres.map((g) => (
                    <option key={g.key} value={g.key}>{g.title}</option>
                  ))}
                </select>
              )}
              <input className="year" placeholder="From" inputMode="numeric" value={filters.yearMin} onChange={(e) => setF({ yearMin: e.target.value.replace(/\D/g, '').slice(0, 4) })} aria-label="Year from" />
              <input className="year" placeholder="To" inputMode="numeric" value={filters.yearMax} onChange={(e) => setF({ yearMax: e.target.value.replace(/\D/g, '').slice(0, 4) })} aria-label="Year to" />
              <label className="small nowrap">
                <input type="checkbox" checked={filters.unwatched} onChange={(e) => setF({ unwatched: e.target.checked })} /> Unwatched
              </label>
            </>
          )}
          <label className="small nowrap" title={index ? '' : 'Scanning playlists…'}>
            <input type="checkbox" checked={notInPlaylist} disabled={!index} onChange={(e) => setNotInPlaylist(e.target.checked)} /> Not in any playlist
          </label>
          {filtered && !trail.length && (
            <button className="link" onClick={() => (setFilters({ ...NO_FILTERS, sort: filters.sort, dir: filters.dir }), setQInput(''))}>Clear filters</button>
          )}
          <span className="spacer" />
          <div className="seg">
            <button className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="List view">☰</button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => changeView('grid')} title="Poster view">▦</button>
          </div>
        </div>

        {!trail.length && letters.length > 1 && filters.sort === 'title' && (
          <div className="letters">
            {letters.map((l) => (
              <button
                key={l.key}
                className={filters.letter === l.key ? 'on' : ''}
                onClick={() => (setQInput(''), setF({ letter: filters.letter === l.key ? '' : l.key, q: '' }))}
                title={plural(l.size, 'title')}
              >
                {l.title}
              </button>
            ))}
          </div>
        )}

        <div className="lib-actions">
          <span className="muted small">
            {trail.length
              ? children ? plural(shown.length, 'item') : 'Loading…'
              : `${notInPlaylist ? `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} loaded` : `${items.length.toLocaleString()} of ${total.toLocaleString()}`}`}
          </span>
          <button className="link" onClick={() => setPicked(new Map(shown.filter((i) => i.type !== 'collection').map((i) => [i.ratingKey, i])))} disabled={!shown.length}>
            Select all shown
          </button>
          {picked.size > 0 && <button className="link" onClick={() => setPicked(new Map())}>Clear ({picked.size})</button>}
          <button className="primary" disabled={!picked.size} onClick={() => setAdding([...picked.values()])}>
            Add {picked.size || ''} to playlist / collection…
          </button>
          <span className="spacer" />
          <label className="small nowrap quick">
            Quick add to
            <select
              value={quick?.ratingKey ?? ''}
              onChange={(e) => {
                const p = playlistsForQuick.find((x) => x.ratingKey === e.target.value);
                rememberQuick(p ? { ratingKey: p.ratingKey, title: p.title } : null);
              }}
            >
              <option value="">(none)</option>
              {quick && !playlistsForQuick.some((p) => p.ratingKey === quick.ratingKey) && <option value={quick.ratingKey}>{quick.title}</option>}
              {playlistsForQuick.map((p) => (
                <option key={p.ratingKey} value={p.ratingKey}>{p.title}</option>
              ))}
            </select>
          </label>
        </div>

        {listError && <div className="banner error">{listError}</div>}

        <div className={view === 'grid' ? 'lib-grid' : 'lib-list'}>
          {shown.map((i) =>
            view === 'grid' ? (
              <GridCard key={i.ratingKey} item={i} acctId={acctId} focused={focus?.ratingKey === i.ratingKey} picked={picked.has(i.ratingKey)}
                onFocus={() => setFocus(i)} onPick={() => togglePick(i)} onDrill={() => drill(i)} quick={quick} onQuick={() => quickAdd(i)} />
            ) : (
              <ListRow key={i.ratingKey} item={i} acctId={acctId} focused={focus?.ratingKey === i.ratingKey} picked={picked.has(i.ratingKey)}
                onFocus={() => setFocus(i)} onPick={() => togglePick(i)} onDrill={() => drill(i)} quick={quick} onQuick={() => quickAdd(i)} />
            ),
          )}
          {!trail.length && <div ref={sentinel} className="sentinel">{loading ? 'Loading…' : hasMore ? '' : items.length ? '' : 'No titles match.'}</div>}
          {trail.length > 0 && children && !shown.length && <div className="empty-state">Nothing here.</div>}
        </div>
      </main>

      <aside className="sidebar sidebar-right">
        {focus ? (
          <TitlePanel
            key={focus.ratingKey}
            item={focus}
            onAddedToPlaylist={(a, p) => a === acctId && rememberQuick({ ratingKey: p.ratingKey, title: p.title })}
            onItemChanged={(fresh) => {
              const patch = (l: Item[]) => l.map((x) => (x.ratingKey === fresh.ratingKey ? { ...x, title: fresh.title, displayTitle: fresh.displayTitle, year: fresh.year, thumb: fresh.thumb, art: fresh.art } : x));
              setItems(patch);
              setChildren((c) => (c ? patch(c) : c));
              setTrail(patch);
            }}
          />
        ) : (
          <div className="muted pad">
            Click a title to see its details and which playlists it's in. Double-click a show or album to open it.
          </div>
        )}
      </aside>

      {adding && (
        <TargetPicker
          kind="playlist"
          switchable
          ratingKeys={adding.map((i) => i.ratingKey)}
          itemType={adding[0].type}
          defaultTitle={adding.length === 1 ? adding[0].title : ''}
          onClose={() => setAdding(null)}
          onDone={(a) => {
            invalidatePlaylistIndex(a);
            setPicked(new Map());
          }}
        />
      )}
    </div>
  );
}

interface CardProps {
  item: Item;
  acctId: string;
  focused: boolean;
  picked: boolean;
  quick: QuickTarget | null;
  onFocus: () => void;
  onPick: () => void;
  onDrill: () => void;
  onQuick: () => void;
}

function subtitle(i: Item) {
  if (i.type === 'show' || i.type === 'artist') return i.childCount ? plural(i.childCount, i.type === 'show' ? 'season' : 'album') : '';
  if (i.type === 'season' || i.type === 'album') return i.leafCount ? plural(i.leafCount, i.type === 'season' ? 'episode' : 'track') : '';
  return fmtDuration(i.duration);
}

function watched(i: Item) {
  if (isGroupType(i.type)) return i.leafCount ? (i.viewedLeafCount ?? 0) >= i.leafCount : false;
  return !!i.viewCount;
}

function ListRow({ item: i, acctId, focused, picked, quick, onFocus, onPick, onDrill, onQuick }: CardProps) {
  const canDrill = DRILLABLE.includes(i.type);
  return (
    <div className={`lib-row ${focused ? 'focus' : ''} ${picked ? 'on' : ''}`} onClick={onFocus} onDoubleClick={() => canDrill && onDrill()}>
      <input type="checkbox" checked={picked} onClick={(e) => e.stopPropagation()} onChange={onPick} aria-label="Select" />
      <Thumb acct={acctId} path={i.thumb} w={30} h={45} square={['album', 'artist', 'track'].includes(i.type)} />
      <span className="grow ellipsis" title={i.displayTitle}>
        {i.type === 'episode' ? `E${String(i.index ?? '?').padStart(2, '0')} · ${i.title}` : i.type === 'track' ? `${i.index ?? ''}. ${i.title}` : i.title}
        {watched(i) && <span className="watched" title="Watched">✓</span>}
      </span>
      <span className="muted small yr">{i.year ?? ''}</span>
      <span className="muted small sub">{subtitle(i)}</span>
      {quick && i.type !== 'collection' && (
        <button className="quick-btn" title={`Add to “${quick.title}”`} onClick={(e) => (e.stopPropagation(), onQuick())}>+</button>
      )}
      {canDrill ? (
        <button className="icon drill" title="Open" onClick={(e) => (e.stopPropagation(), onDrill())}>›</button>
      ) : (
        <span className="drill" />
      )}
    </div>
  );
}

function GridCard({ item: i, acctId, focused, picked, quick, onFocus, onPick, onDrill, onQuick }: CardProps) {
  const canDrill = DRILLABLE.includes(i.type);
  const square = ['album', 'artist', 'track'].includes(i.type);
  const wide = i.type === 'episode';
  return (
    <div className={`lib-card ${focused ? 'focus' : ''} ${picked ? 'on' : ''} ${wide ? 'wide' : ''}`} onClick={onFocus} onDoubleClick={() => canDrill && onDrill()}>
      <div className="poster">
        <Thumb acct={acctId} path={i.thumb} w={wide ? 220 : 130} h={wide ? 124 : 195} square={square} />
        <input type="checkbox" checked={picked} onClick={(e) => e.stopPropagation()} onChange={onPick} aria-label="Select" />
        {watched(i) && <span className="badge-watched">✓</span>}
        {quick && i.type !== 'collection' && (
          <button className="quick-btn" title={`Add to “${quick.title}”`} onClick={(e) => (e.stopPropagation(), onQuick())}>+</button>
        )}
      </div>
      <div className="card-title ellipsis" title={i.displayTitle}>
        {i.type === 'episode' ? `E${String(i.index ?? '?').padStart(2, '0')} · ${i.title}` : i.title}
      </div>
      <div className="muted small ellipsis">
        {[i.year, TYPE_LABEL[i.type] && i.type !== 'movie' ? TYPE_LABEL[i.type] : '', subtitle(i)].filter(Boolean).join(' · ')}
        {canDrill && (
          <button className="link" onClick={(e) => (e.stopPropagation(), onDrill())}>open ›</button>
        )}
      </div>
    </div>
  );
}
