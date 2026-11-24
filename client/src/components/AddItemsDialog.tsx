import { useState } from 'react';
import type { Item } from '../types';
import { Modal } from './Modal';
import { Thumb } from './Thumb';
import { useSearch } from './useSearch';
import { TYPE_LABEL, plural } from '../util';

/** Search the library and add the picked titles to the open playlist/collection. */
export function AddItemsDialog({ acctId, title, existing, onAdd, onClose }: {
  acctId: string;
  title: string;
  existing: Set<string>;
  onAdd: (items: Item[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, Item>>(new Map());
  const { hubs, loading, error } = useSearch(acctId, q);

  const toggle = (i: Item) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(i.ratingKey)) n.delete(i.ratingKey);
      else n.set(i.ratingKey, i);
      return n;
    });

  return (
    <Modal
      wide
      title={`Add to “${title}”`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">
            {picked.size ? `${plural(picked.size, 'title')} picked. Shows and seasons add all their episodes.` : 'Search, then tick titles to add.'}
          </span>
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            disabled={!picked.size}
            onClick={async () => {
              if (await onAdd([...picked.values()])) setPicked(new Map());
            }}
          >
            Add {picked.size || ''}
          </button>
        </>
      }
    >
      <input autoFocus className="search-input" placeholder="Search movies, shows, episodes, music…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="banner error">{error}</div>}
      {loading && <div className="muted">Searching…</div>}
      <div className="results">
        {hubs.filter((h) => h.type !== 'collection' && h.type !== 'playlist').map((h) => (
          <section key={h.type}>
            <h3>{h.title}</h3>
            {h.items.map((i) => (
              <label key={i.ratingKey} className={`result ${picked.has(i.ratingKey) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(i.ratingKey)} onChange={() => toggle(i)} />
                <Thumb acct={acctId} path={i.thumb} w={28} h={42} square={i.type === 'track' || i.type === 'album' || i.type === 'artist'} />
                <span className="grow">
                  {i.displayTitle} {i.year ? <span className="muted">({i.year})</span> : null}
                </span>
                {existing.has(i.ratingKey) && <span className="tag">already in list</span>}
                <span className="muted small">{TYPE_LABEL[i.type] ?? i.type}{i.library ? ` · ${i.library}` : ''}</span>
              </label>
            ))}
          </section>
        ))}
        {!loading && q.trim().length >= 2 && !hubs.length && !error && <div className="muted">No matches.</div>}
      </div>
    </Modal>
  );
}
