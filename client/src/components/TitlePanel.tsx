import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp, useCanManageLibrary } from '../ctx';
import type { Collection, IndexedPlaylist, Item, ItemDetails } from '../types';
import { Thumb } from './Thumb';
import { ArtworkDialog } from './ArtworkDialog';
import { EditDialog, type EditTab } from './EditDialog';
import { AddModeSelect, resolveForAdd, useAddMode } from './addMode';
import { entryMatcher, isGroupType, refreshIndexedPlaylist, updatePlaylistIndex, usePlaylistIndex } from './playlistIndex';
import { TYPE_LABEL, cmpText, fmtDuration, plural } from '../util';

const COLLECTABLE = ['movie', 'show', 'artist', 'album'];

/**
 * Right-hand panel for one title: details, artwork, and checkboxes for every
 * playlist (any account) and collection (admin) it can be in.
 */
export function TitlePanel({ item, onItemChanged, onAddedToPlaylist, onReplaced }: {
  item: Item;
  /** The item was merged into another one by Plex; show that one instead. */
  onReplaced?: (oldRatingKey: string, item: Item) => void;
  /** Called after artwork or metadata changes, with fresh details. */
  onItemChanged?: (fresh: ItemDetails) => void;
  onAddedToPlaylist?: (acctId: string, playlist: { ratingKey: string; title: string }) => void;
}) {
  const { acct } = useApp();
  const [details, setDetails] = useState<ItemDetails | null>(null);
  const [artOpen, setArtOpen] = useState(false);
  const [tab, setTab] = useState<'playlists' | 'collections'>('playlists');

  const loadDetails = async () => {
    try {
      const d = await api.item(acct!.id, item.ratingKey);
      setDetails(d);
      return d;
    } catch {
      return null;
    }
  };
  useEffect(() => {
    setDetails(null);
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.ratingKey, acct?.id]);

  const shown = details ?? item;
  const square = ['track', 'album', 'artist'].includes(item.type);
  const canManage = useCanManageLibrary();
  const canCollect = COLLECTABLE.includes(item.type) && canManage;
  const canEditMeta = canManage;
  const [editTab, setEditTab] = useState<EditTab | null>(null);
  const { notify, busy } = useApp();
  const isWatched = isGroupType(item.type)
    ? !!shown.leafCount && (shown.viewedLeafCount ?? 0) >= shown.leafCount
    : !!shown.viewCount;
  const canWatch = ['movie', 'episode', 'show', 'season', 'track', 'album', 'artist'].includes(item.type);
  const toggleWatched = async () => {
    const ok = await busy(isWatched ? 'Marking unwatched…' : 'Marking watched…', () => api.setWatched(acct!.id, [item.ratingKey], !isWatched));
    if (!ok) return;
    notify(`${shown.displayTitle}: marked ${isWatched ? 'unwatched' : 'watched'} for ${acct!.name}`, 'ok');
    const d = await loadDetails();
    if (d) onItemChanged?.(d);
  };

  return (
    <div className="membership">
      <div className="member-head">
        <Thumb acct={acct!.id} path={shown.thumb} w={80} h={120} square={square} />
        <div className="grow">
          <h2>{shown.displayTitle}</h2>
          <div className="muted small">
            {TYPE_LABEL[item.type] ?? item.type}
            {shown.year ? ` · ${shown.year}` : ''}
            {shown.library ? ` · ${shown.library}` : ''}
            {shown.duration && !isGroupType(item.type) ? ` · ${fmtDuration(shown.duration)}` : ''}
            {shown.leafCount && isGroupType(item.type) ? ` · ${plural(shown.leafCount, item.type === 'artist' || item.type === 'album' ? 'track' : 'episode')}` : ''}
          </div>
          {details?.summary && <p className="summary small">{details.summary}</p>}
          {item.type !== 'collection' && (
            <div className="panel-actions">
              {canEditMeta && <button className="small-btn" onClick={() => setEditTab('general')}>Edit…</button>}
              {canEditMeta && ['movie', 'show', 'artist', 'album'].includes(item.type) && (
                <button className="small-btn" onClick={() => setEditTab('match')}>Match…</button>
              )}
              {canWatch && (
                <button className="small-btn" onClick={toggleWatched} title={`For ${acct!.name}`}>
                  {isWatched ? 'Mark unwatched' : 'Mark watched'}
                </button>
              )}
              <button className="small-btn" onClick={() => setEditTab('info')}>Info</button>
              <button className="small-btn" onClick={() => setArtOpen(true)}>Artwork…</button>
            </div>
          )}
        </div>
      </div>

      {item.type === 'collection' ? (
        <div className="muted pad">Open the Collections tab to edit this collection.</div>
      ) : (
        <>
          {canCollect && (
            <div className="seg pad-x">
              <button className={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>Playlists</button>
              <button className={tab === 'collections' ? 'on' : ''} onClick={() => setTab('collections')}>
                Collections{details?.collections.length ? ` (${details.collections.length})` : ''}
              </button>
            </div>
          )}
          {tab === 'playlists' || !canCollect ? (
            <PlaylistChecks item={item} onAdded={onAddedToPlaylist} />
          ) : (
            <CollectionChecks item={item} details={details} setDetails={setDetails} />
          )}
        </>
      )}

      {editTab && (
        <EditDialog
          acctId={acct!.id}
          ratingKey={item.ratingKey}
          title={shown.displayTitle}
          type={item.type}
          initialTab={editTab}
          onClose={() => setEditTab(null)}
          onSaved={async () => {
            const d = await loadDetails();
            if (d) onItemChanged?.(d);
          }}
          onReplaced={(old, fresh) => onReplaced?.(old, fresh)}
        />
      )}

      {artOpen && (
        <ArtworkDialog
          acctId={acct!.id}
          ratingKey={item.ratingKey}
          title={shown.displayTitle}
          itemType={item.type}
          onClose={() => setArtOpen(false)}
          onChanged={async () => {
            const d = await loadDetails();
            if (d) onItemChanged?.(d);
          }}
        />
      )}
    </div>
  );
}

function PlaylistChecks({ item, onAdded }: { item: Item; onAdded?: (acctId: string, p: { ratingKey: string; title: string }) => void }) {
  const { acct, accounts, notify } = useApp();
  const [acctId, setAcctId] = useState(acct!.id);
  const { index, error, reload } = usePlaylistIndex(acctId);
  const [filter, setFilter] = useState('');
  const [onlyIn, setOnlyIn] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const matches = useMemo(() => entryMatcher(item), [item]);
  const group = isGroupType(item.type);
  const [mode, setMode] = useAddMode();

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (index ?? [])
      .map((p) => ({ p, hits: p.entries.filter(matches) }))
      .filter((r) => r.p.title.toLowerCase().includes(f) && (!onlyIn || r.hits.length))
      .sort((a, b) => (b.hits.length ? 1 : 0) - (a.hits.length ? 1 : 0) || cmpText(a.p.title, b.p.title));
  }, [index, filter, onlyIn, matches]);
  const inCount = (index ?? []).filter((p) => p.entries.some(matches)).length;

  const toggle = async (p: IndexedPlaylist, hits: IndexedPlaylist['entries']) => {
    setPending((s) => new Set(s).add(p.ratingKey));
    try {
      if (hits.length) {
        await api.removeFromPlaylist(acctId, p.ratingKey, hits.map((h) => h.pid));
        updatePlaylistIndex(acctId, (ix) => ix.map((x) => (x.ratingKey === p.ratingKey ? { ...x, entries: x.entries.filter((e) => !hits.includes(e)) } : x)));
        notify(`Removed from “${p.title}”`, 'ok');
      } else {
        const { keys } = await resolveForAdd(acctId, [item], mode);
        if (!keys.length) throw new Error('This has no episodes to add yet.');
        await api.addToPlaylist(acctId, p.ratingKey, keys);
        await refreshIndexedPlaylist(acctId, p.ratingKey);
        const what = group ? (mode === 'first' ? 'First episode added' : mode === 'next' ? 'Next unwatched episode added' : 'Added') : 'Added';
        notify(`${what} to “${p.title}”`, 'ok');
        onAdded?.(acctId, p);
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
    <>
      <div className="row-tools">
        <select value={acctId} onChange={(e) => setAcctId(e.target.value)} aria-label="Whose playlists">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}'s playlists</option>
          ))}
        </select>
        <button className="icon" onClick={reload} title="Re-scan playlists">↻</button>
      </div>
      <div className="row-tools">
        <input className="filter" placeholder="Filter playlists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="small nowrap">
          <input type="checkbox" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} /> only ones it's in
        </label>
      </div>
      {group && (
        <div className="row-tools">
          <AddModeSelect mode={mode} onChange={setMode} />
        </div>
      )}
      {index && <div className="small pad-x muted">In {plural(inCount, 'playlist')}</div>}
      {error && <div className="banner error">{error}</div>}
      {!index && !error && <div className="muted pad">Scanning playlists… (the first time can take a moment if you have lots)</div>}
      <div className="side-list">
        {rows.map(({ p, hits }) => (
          <label key={p.ratingKey} className={`side-item ${hits.length ? 'active-soft' : ''}`}>
            <input
              type="checkbox"
              checked={hits.length > 0}
              disabled={pending.has(p.ratingKey)}
              onChange={() => {
                if (hits.length > 1 && !confirm(`Remove all ${hits.length} ${group ? 'episodes/tracks' : 'copies'} from “${p.title}”?`)) return;
                toggle(p, hits);
              }}
            />
            <span className="grow ellipsis" title={p.title}>{p.title}</span>
            {(group ? hits.length > 0 : hits.length > 1) && <span className="tag" title="Times it appears">{hits.length}×</span>}
            <span className="muted small">{p.leafCount}</span>
          </label>
        ))}
      </div>
      {index && <p className="muted small pad">Smart playlists aren't listed because Plex fills them from rules.</p>}
    </>
  );
}

function CollectionChecks({ item, details, setDetails }: {
  item: Item;
  details: ItemDetails | null;
  setDetails: (d: ItemDetails) => void;
}) {
  const { acct, notify } = useApp();
  const [cols, setCols] = useState<Collection[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const sec = details?.librarySectionID;

  useEffect(() => {
    if (!sec) return;
    setCols(null);
    api.collections(acct!.id, sec).then(
      (c) => setCols(c.filter((x) => !x.smart).sort((a, b) => cmpText(a.title, b.title))),
      (e) => setError(errMsg(e)),
    );
  }, [sec, acct]);

  const inSet = new Set(details?.collections ?? []);
  const shown = (cols ?? []).filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  shown.sort((a, b) => (inSet.has(b.title) ? 1 : 0) - (inSet.has(a.title) ? 1 : 0));

  const toggle = async (c: Collection) => {
    if (!details) return;
    setPending(c.ratingKey);
    try {
      const isIn = inSet.has(c.title);
      if (isIn) await api.removeFromCollection(acct!.id, c.ratingKey, item.ratingKey);
      else await api.addToCollection(acct!.id, c.ratingKey, [item.ratingKey]);
      setDetails({ ...details, collections: isIn ? details.collections.filter((t) => t !== c.title) : [...details.collections, c.title] });
      setCols((cs) => cs?.map((x) => (x.ratingKey === c.ratingKey ? { ...x, leafCount: x.leafCount + (isIn ? -1 : 1) } : x)) ?? cs);
      notify(`${isIn ? 'Removed from' : 'Added to'} “${c.title}”`, 'ok');
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <div className="row-tools">
        <input className="filter" placeholder="Filter collections…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <div className="banner error">{error}</div>}
      {!cols && !error && <div className="muted pad">Loading collections…</div>}
      <div className="side-list">
        {shown.map((c) => (
          <label key={c.ratingKey} className={`side-item ${inSet.has(c.title) ? 'active-soft' : ''}`}>
            <input type="checkbox" checked={inSet.has(c.title)} disabled={pending === c.ratingKey} onChange={() => toggle(c)} />
            <span className="grow ellipsis" title={c.title}>{c.title}</span>
            <span className="muted small">{c.leafCount}</span>
          </label>
        ))}
        {cols && !shown.length && <div className="muted pad">No collections in this library yet. Create one from the Collections tab or with “Add to playlist / collection…”.</div>}
      </div>
    </>
  );
}
