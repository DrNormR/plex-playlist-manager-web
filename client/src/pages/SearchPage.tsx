import { useEffect, useState } from 'react';
import { useApp } from '../ctx';
import type { Item } from '../types';
import { Thumb } from '../components/Thumb';
import { TargetPicker } from '../components/TargetPicker';
import { TitlePanel } from '../components/TitlePanel';
import { useSearch } from '../components/useSearch';
import { invalidatePlaylistIndex } from '../components/playlistIndex';
import { TYPE_LABEL } from '../util';

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
          <TitlePanel key={focus.ratingKey} item={focus} onReplaced={(_old, fresh) => setFocus(fresh)} />
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
            invalidatePlaylistIndex(a);
            setPicked(new Map());
          }}
        />
      )}
    </div>
  );
}
