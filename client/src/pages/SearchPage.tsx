import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { IndexedPlaylist, Item } from '../types';
import { Thumb } from '../components/Thumb';
import { TargetPicker } from '../components/TargetPicker';
import { useSearch } from '../components/useSearch';
import { TYPE_LABEL, cmpText, plural } from '../util';

// Playlist contents per account, kept while the app is open so switching back is instant.
const indexCache = new Map<string, IndexedPlaylist[]>();

export function SearchPage() {
  const { acct } = useApp();
  const [q, setQ] = useState(() => sessionStorage.getItem('ppm.q') ?? '');
  const { hubs, loading, error } = useSearch(acct!.id, q);
  const [picked, setPicked] = useState<Map<string, Item>>(new Map());
  const [focus, setFocus] = useState<Item | null>(null);
  const [adding, setAdding] = useState<Item[] | null>(null);

  useEffect(() => {
    sessionStorage.setItem('ppm.q', q);
  }, [q]);

  const toggle = (i: Item) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(i.ratingKey)) n.delete(i.ratingKey);
      else n.set(i.ratingKey, i);
      return n;
    });

  return (
    <div className="split search-page">
      <section className="main">
        <div className="search-bar">
          <input
            autoFocus
            className="search-input"
            placeholder={`Search ${acct!.name}'s libraries…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button disabled={!picked.size} className="primary" onClick={() => setAdding([...picked.values()])}>
            Add {picked.size || ''} to playlist / collection…
          </button>
          {picked.size > 0 && <button className="link" onClick={() => setPicked(new Map())}>clear</button>}
        </div>
        {error && <div className="banner error">{error}</div>}
        {loading && <div className="muted pad">Searching…</div>}
        {!q.trim() && (
          <div className="empty-state">
            Search for a title, then click it to see and change which playlists it's in. Tick several to add them anywhere at once.
          </div>
        )}
        <div className="results">
          {hubs.filter((h) => h.type !== 'playlist').map((h) => (
            <section key={h.type}>
              <h3>{h.title}</h3>
              {h.items.map((i) => (
                <div
                  key={i.ratingKey}
                  className={`result ${focus?.ratingKey === i.ratingKey ? 'focus' : ''} ${picked.has(i.ratingKey) ? 'on' : ''}`}
                  onClick={() => setFocus(i)}
                >
                  {i.type !== 'collection' && (
                    <input type="checkbox" checked={picked.has(i.ratingKey)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(i)} />
                  )}
                  <Thumb acct={acct!.id} path={i.thumb} w={32} h={48} square={['track', 'album', 'artist'].includes(i.type)} />
                  <span className="grow">
                    {i.displayTitle} {i.year ? <span className="muted">({i.year})</span> : null}
                  </span>
                  <span className="muted small">
                    {TYPE_LABEL[i.type] ?? i.type}
                    {i.library ? ` · ${i.library}` : ''}
                    {i.leafCount && i.type !== 'episode' ? ` · ${i.leafCount}` : ''}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {!loading && q.trim().length >= 2 && !hubs.length && !error && <div className="muted pad">No matches.</div>}
        </div>
      </section>

      <aside className="sidebar sidebar-right">
        {focus ? (
          <Membership key={focus.ratingKey} item={focus} />
        ) : (
          <div className="muted pad">Click a search result to see which playlists it's in.</div>
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
            indexCache.delete(a);
            setPicked(new Map());
            if (focus) setFocus({ ...focus });
          }}
        />
      )}
    </div>
  );
}

function Membership({ item }: { item: Item }) {
  const { acct, accounts, notify } = useApp();
  const [acctId, setAcctId] = useState(acct!.id);
  const [index, setIndex] = useState<IndexedPlaylist[] | null>(indexCache.get(acctId) ?? null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [onlyIn, setOnlyIn] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async (force = false) => {
    setLoadError('');
    if (!force && indexCache.has(acctId)) return setIndex(indexCache.get(acctId)!);
    setIndex(null);
    try {
      const ix = await api.playlistIndex(acctId);
      indexCache.set(acctId, ix);
      setIndex(ix);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, [acctId]);

  useEffect(() => {
    load();
  }, [load]);

  const isGroup = ['show', 'season', 'artist', 'album'].includes(item.type);
  const matches = (e: IndexedPlaylist['entries'][number]) =>
    e.rk === item.ratingKey || (isGroup && (e.gk === item.ratingKey || e.pk === item.ratingKey));

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (index ?? [])
      .map((p) => ({ p, hits: p.entries.filter(matches) }))
      .filter((r) => r.p.title.toLowerCase().includes(f) && (!onlyIn || r.hits.length))
      .sort((a, b) => (b.hits.length ? 1 : 0) - (a.hits.length ? 1 : 0) || cmpText(a.p.title, b.p.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, filter, onlyIn, item.ratingKey]);

  const inCount = (index ?? []).filter((p) => p.entries.some(matches)).length;

  const refreshOne = async (plId: string) => {
    const { playlist, items } = await api.playlist(acctId, plId);
    const entries = items.map((i) => ({ rk: i.ratingKey, pid: i.playlistItemID!, gk: i.grandparentKey, pk: i.parentKey }));
    setIndex((ix) => {
      const next = (ix ?? []).map((p) => (p.ratingKey === plId ? { ...p, ...playlist, entries } : p));
      indexCache.set(acctId, next);
      return next;
    });
  };

  const toggle = async (p: IndexedPlaylist, hits: IndexedPlaylist['entries']) => {
    setPending((s) => new Set(s).add(p.ratingKey));
    try {
      if (hits.length) {
        await api.removeFromPlaylist(acctId, p.ratingKey, hits.map((h) => h.pid));
        notify(`Removed from “${p.title}”`, 'ok');
        setIndex((ix) => {
          const next = (ix ?? []).map((x) => (x.ratingKey === p.ratingKey ? { ...x, entries: x.entries.filter((e) => !hits.includes(e)) } : x));
          indexCache.set(acctId, next);
          return next;
        });
      } else {
        await api.addToPlaylist(acctId, p.ratingKey, [item.ratingKey]);
        notify(`Added to “${p.title}”`, 'ok');
        await refreshOne(p.ratingKey);
      }
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(p.ratingKey);
        return n;
      });
    }
  };

  return (
    <div className="membership">
      <div className="member-head">
        <Thumb acct={acctId} path={item.thumb} w={60} h={90} square={['track', 'album', 'artist'].includes(item.type)} />
        <div>
          <h2>{item.displayTitle}</h2>
          <div className="muted small">
            {TYPE_LABEL[item.type] ?? item.type}
            {item.year ? ` · ${item.year}` : ''}
            {item.library ? ` · ${item.library}` : ''}
          </div>
          {index && <div className="small">In {plural(inCount, 'playlist')}</div>}
        </div>
      </div>
      {item.type === 'collection' ? (
        <div className="muted pad">Open the Collections tab to edit this collection.</div>
      ) : (
        <>
          <div className="row-tools">
            <select value={acctId} onChange={(e) => setAcctId(e.target.value)} aria-label="Whose playlists">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}'s playlists</option>
              ))}
            </select>
            <button className="icon" onClick={() => load(true)} title="Re-scan playlists">↻</button>
          </div>
          <div className="row-tools">
            <input className="filter" placeholder="Filter playlists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="small nowrap">
              <input type="checkbox" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} /> only ones it's in
            </label>
          </div>
          {loadError && <div className="banner error">{loadError}</div>}
          {!index && !loadError && <div className="muted pad">Scanning playlists… (the first time can take a moment if you have lots)</div>}
          <div className="side-list">
            {rows.map(({ p, hits }) => (
              <label key={p.ratingKey} className={`side-item ${hits.length ? 'active-soft' : ''}`}>
                <input
                  type="checkbox"
                  checked={hits.length > 0}
                  disabled={pending.has(p.ratingKey)}
                  onChange={() => {
                    if (hits.length > 1 && !confirm(`Remove all ${hits.length} ${isGroup ? "episodes/tracks" : "copies"} from “${p.title}”?`)) return;
                    toggle(p, hits);
                  }}
                />
                <span className="grow ellipsis" title={p.title}>{p.title}</span>
                {(isGroup ? hits.length > 0 : hits.length > 1) && <span className="tag" title="Times it appears">{hits.length}×</span>}
                <span className="muted small">{p.leafCount}</span>
              </label>
            ))}
          </div>
          {index && <p className="muted small pad">Smart playlists aren't listed because Plex fills them from rules.</p>}
        </>
      )}
    </div>
  );
}
