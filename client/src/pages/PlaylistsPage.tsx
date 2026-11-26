import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Item, Playlist } from '../types';
import { ItemEditor } from '../components/ItemEditor';
import { AddItemsDialog } from '../components/AddItemsDialog';
import { TargetPicker } from '../components/TargetPicker';
import { Modal } from '../components/Modal';
import { Thumb } from '../components/Thumb';
import { ArtworkDialog } from '../components/ArtworkDialog';
import { cmpText, fmtDuration, plural } from '../util';

type ListSort = 'name' | 'size' | 'updated';

export function PlaylistsPage() {
  const { acct, notify, busy, confirmLeave } = useApp();
  const acctId = acct!.id;
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<ListSort>('name');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => localStorage.getItem(`ppm.pl.${acctId}`));
  const [open, setOpen] = useState<{ playlist: Playlist; items: Item[] } | null>(null);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [dialog, setDialog] = useState<null | { t: 'add' } | { t: 'copyItems'; items: Item[] } | { t: 'copyLists'; ids: string[] } | { t: 'rename' } | { t: 'art' }>(null);

  const loadLists = useCallback(async () => {
    try {
      setLists(await api.playlists(acctId));
      setError('');
    } catch (e) {
      setError(errMsg(e));
      setLists([]);
    }
  }, [acctId]);

  useEffect(() => {
    setLists(null);
    setChecked(new Set());
    setOpen(null);
    setOpenId(localStorage.getItem(`ppm.pl.${acctId}`));
    loadLists();
  }, [acctId, loadLists]);

  const loadOpen = useCallback(async (id: string) => {
    setLoadingOpen(true);
    try {
      setOpen(await api.playlist(acctId, id));
    } catch (e) {
      notify(errMsg(e), 'error');
      setOpen(null);
      setOpenId(null);
    } finally {
      setLoadingOpen(false);
    }
  }, [acctId, notify]);

  useEffect(() => {
    if (openId) {
      localStorage.setItem(`ppm.pl.${acctId}`, openId);
      loadOpen(openId);
    }
  }, [openId, acctId, loadOpen]);

  const types = useMemo(() => [...new Set((lists ?? []).map((l) => l.playlistType))], [lists]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const l = (lists ?? []).filter((p) => (typeFilter === 'all' || p.playlistType === typeFilter) && p.title.toLowerCase().includes(f));
    if (sort === 'name') l.sort((a, b) => cmpText(a.title, b.title));
    if (sort === 'size') l.sort((a, b) => b.leafCount - a.leafCount);
    if (sort === 'updated') l.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return l;
  }, [lists, filter, sort, typeFilter]);

  const openList = (id: string) => {
    if (id === openId || !confirmLeave()) return;
    setOpenId(id);
  };

  const toggleCheck = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const deleteLists = async (ids: string[]) => {
    const names = ids.map((id) => lists?.find((l) => l.ratingKey === id)?.title).filter(Boolean);
    if (!confirm(`Delete ${plural(ids.length, 'playlist')} from ${acct!.name}'s account?\n\n${names.slice(0, 15).join('\n')}${names.length > 15 ? '\n…' : ''}\n\nThis cannot be undone.`)) return;
    const ok = await busy('Deleting playlists…', async () => {
      for (const id of ids) await api.deletePlaylist(acctId, id);
      return true;
    });
    if (!ok) return loadLists();
    if (ids.includes(openId ?? '')) {
      setOpen(null);
      setOpenId(null);
    }
    setChecked(new Set());
    notify(`Deleted ${plural(ids.length, 'playlist')}`, 'ok');
    loadLists();
  };

  const p = open?.playlist;

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="side-tools">
          <input className="filter" placeholder={`Filter ${lists ? plural(lists.length, 'playlist') : 'playlists'}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="row-tools">
            <select value={sort} onChange={(e) => setSort(e.target.value as ListSort)} aria-label="Sort playlists">
              <option value="name">Name</option>
              <option value="size">Most items</option>
              <option value="updated">Recently changed</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Playlist type">
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button className="icon" onClick={loadLists} title="Reload playlists">↻</button>
          </div>
          {checked.size > 0 && (
            <div className="bulk">
              <span>{checked.size} checked</span>
              <button onClick={() => setDialog({ t: 'copyLists', ids: [...checked] })}>Copy to account…</button>
              <button className="danger" onClick={() => deleteLists([...checked])}>Delete</button>
              <button className="link" onClick={() => setChecked(new Set())}>clear</button>
            </div>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="side-list">
          {lists === null && <div className="muted pad">Loading playlists…</div>}
          {shown.map((l) => (
            <div key={l.ratingKey} className={`side-item ${openId === l.ratingKey ? 'active' : ''}`} onClick={() => openList(l.ratingKey)}>
              <input type="checkbox" checked={checked.has(l.ratingKey)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(l.ratingKey)} aria-label={`Check ${l.title}`} />
              <Thumb acct={acctId} path={l.thumb} w={32} square />
              <span className="grow ellipsis" title={l.title}>{l.title}</span>
              {l.smart && <span className="tag">smart</span>}
              <span className="muted small">{l.leafCount}</span>
            </div>
          ))}
          {lists && !shown.length && <div className="muted pad">No playlists match.</div>}
        </div>
      </aside>

      <main className="main">
        {!openId && <div className="empty-state big">Pick a playlist on the left.</div>}
        {openId && loadingOpen && !open && <div className="empty-state">Loading…</div>}
        {open && p && (
          <ItemEditor
            key={p.ratingKey}
            mode="playlist"
            acctId={acctId}
            items={open.items}
            readOnly={p.smart}
            readOnlyReason="Smart playlists are built from rules in Plex, so their order and contents can't be edited here. You can still copy items out of them."
            onApply={async (remove, order) => {
              const r = await api.applyPlaylist(acctId, p.ratingKey, remove, order);
              setOpen({ playlist: { ...p, leafCount: r.items.length }, items: r.items });
              setLists((ls) => ls?.map((x) => (x.ratingKey === p.ratingKey ? { ...x, leafCount: r.items.length } : x)) ?? ls);
              return r.items;
            }}
            onAddClick={() => setDialog({ t: 'add' })}
            onCopySelected={(items) => setDialog({ t: 'copyItems', items })}
            header={
              <div className="title-row">
                <h1>{p.title}</h1>
                <span className="tag">{p.playlistType}</span>
                {p.duration ? <span className="muted small">{fmtDuration(p.duration)}</span> : null}
                <span className="spacer" />
                <button onClick={() => setDialog({ t: 'rename' })}>Rename</button>
                <button onClick={() => setDialog({ t: 'art' })}>Artwork…</button>
                <button onClick={() => setDialog({ t: 'copyLists', ids: [p.ratingKey] })}>Duplicate / copy to account…</button>
                <button onClick={() => loadOpen(p.ratingKey)} title="Reload from Plex">↻</button>
                <button className="danger" onClick={() => deleteLists([p.ratingKey])}>Delete</button>
              </div>
            }
          />
        )}
      </main>

      {dialog?.t === 'add' && open && (
        <AddItemsDialog
          acctId={acctId}
          title={open.playlist.title}
          existing={new Set(open.items.map((i) => i.ratingKey))}
          onClose={() => setDialog(null)}
          onAdd={async (items) => {
            const ok = await busy('Adding…', () => api.addToPlaylist(acctId, open.playlist.ratingKey, items.map((i) => i.ratingKey)));
            if (ok) {
              notify(`Added ${plural(items.length, 'title')}`, 'ok');
              await loadOpen(open.playlist.ratingKey);
              loadLists();
            }
            return !!ok;
          }}
        />
      )}

      {dialog?.t === 'copyItems' && (
        <TargetPicker
          kind="playlist"
          switchable
          items={dialog.items}
          onClose={() => setDialog(null)}
          onDone={(a) => a === acctId && loadLists()}
        />
      )}

      {dialog?.t === 'copyLists' && lists && (
        <CopyPlaylistsDialog
          playlists={dialog.ids.map((id) => lists.find((l) => l.ratingKey === id)!).filter(Boolean)}
          onClose={() => setDialog(null)}
          onDone={(target) => {
            setChecked(new Set());
            if (target === acctId) loadLists();
          }}
        />
      )}

      {dialog?.t === 'art' && p && (
        <ArtworkDialog
          acctId={acctId}
          ratingKey={p.ratingKey}
          title={p.title}
          itemType="playlist"
          onClose={() => setDialog(null)}
          onChanged={() => loadLists()}
        />
      )}

      {dialog?.t === 'rename' && p && (
        <RenameDialog
          current={p.title}
          onClose={() => setDialog(null)}
          onSave={async (title) => {
            const ok = await busy('Renaming…', () => api.renamePlaylist(acctId, p.ratingKey, title));
            if (ok) {
              setOpen((o) => (o ? { ...o, playlist: { ...o.playlist, title } } : o));
              setLists((ls) => ls?.map((x) => (x.ratingKey === p.ratingKey ? { ...x, title } : x)) ?? ls);
              setDialog(null);
            }
          }}
        />
      )}
    </div>
  );
}

export function RenameDialog({ current, onSave, onClose }: { current: string; onSave: (t: string) => void; onClose: () => void }) {
  const [t, setT] = useState(current);
  return (
    <Modal
      title="Rename"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!t.trim() || t.trim() === current} onClick={() => onSave(t.trim())}>Save</button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), t.trim() && onSave(t.trim()))}>
        <input autoFocus className="grow full" value={t} onChange={(e) => setT(e.target.value)} />
      </form>
    </Modal>
  );
}

/** Copy one or many playlists (in order) to the same or another account. */
function CopyPlaylistsDialog({ playlists, onClose, onDone }: { playlists: Playlist[]; onClose: () => void; onDone: (acctId: string) => void }) {
  const { accounts, acct, busy, notify } = useApp();
  const others = accounts.filter((a) => a.id !== acct!.id);
  const [target, setTarget] = useState(others[0]?.id ?? acct!.id);
  const single = playlists.length === 1;
  const [into, setInto] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState(single ? playlists[0].title : '');
  const [suffix, setSuffix] = useState('');
  const [targetLists, setTargetLists] = useState<Playlist[] | null>(null);
  const [existingId, setExistingId] = useState('');
  const [skipDupes, setSkipDupes] = useState(true);
  const sameAcct = target === acct!.id;
  const targetName = accounts.find((a) => a.id === target)?.name ?? 'that account';
  const playlistKey = playlists.map((p) => p.ratingKey).join(',');

  useEffect(() => {
    setTargetLists(null);
    setExistingId('');
    api.playlists(target).then(
      (l) => {
        const regular = l.filter((p) => !p.smart).sort((a, b) => cmpText(a.title, b.title));
        setTargetLists(regular);
        // Pre-select a playlist with the same name, if the other profile has one.
        if (single) setExistingId(regular.find((p) => p.title === playlists[0].title && !(sameAcct && p.ratingKey === playlists[0].ratingKey))?.ratingKey ?? '');
      },
      () => setTargetLists([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, playlistKey]);

  const run = async () => {
    const res = await busy(`Copying ${plural(playlists.length, 'playlist')} to ${targetName}…`, async () => {
      let created = 0;
      let merged = 0;
      let added = 0;
      let notAdded = 0;
      let dupes = 0;
      const skipped: string[] = [];
      for (const pl of playlists) {
        const { items } = await api.playlist(acct!.id, pl.ratingKey);
        let keys = items.map((i) => i.ratingKey);
        if (!keys.length) {
          skipped.push(pl.title);
          continue;
        }
        const destId =
          into === 'existing'
            ? single
              ? existingId
              : targetLists?.find((t) => t.title === pl.title && !(sameAcct && t.ratingKey === pl.ratingKey))?.ratingKey
            : undefined;

        if (destId) {
          const before = await api.playlist(target, destId);
          if (skipDupes) {
            const have = new Set(before.items.map((i) => i.ratingKey));
            const seen = new Set<string>();
            const fresh = keys.filter((k) => !have.has(k) && !seen.has(k) && (seen.add(k), true));
            dupes += keys.length - fresh.length;
            keys = fresh;
          }
          if (keys.length) await api.addToPlaylist(target, destId, keys);
          const after = await api.playlist(target, destId);
          const got = after.items.length - before.items.length;
          added += got;
          notAdded += Math.max(0, keys.length - got);
          merged++;
        } else {
          const name = single ? title.trim() : `${pl.title}${suffix}`;
          const made = await api.createPlaylist(target, name, keys, items[0].type);
          const after = await api.playlist(target, made.ratingKey);
          added += after.items.length;
          notAdded += Math.max(0, keys.length - after.items.length);
          created++;
        }
      }
      return { created, merged, added, notAdded, dupes, skipped };
    });
    if (!res) return;
    const parts = [
      res.created && `created ${plural(res.created, 'playlist')}`,
      res.merged && `added into ${plural(res.merged, 'existing playlist')}`,
    ].filter(Boolean);
    notify(
      `${targetName}: ${parts.join(' and ')} · ${plural(res.added, 'item')} added` +
        (res.dupes ? ` · ${res.dupes} already there, skipped` : '') +
        (res.skipped.length ? ` · skipped empty: ${res.skipped.join(', ')}` : ''),
      'ok',
    );
    if (res.notAdded) {
      notify(`${plural(res.notAdded, 'item')} could not be added. ${targetName} may not have access to the library they're in.`, 'error');
    }
    onDone(target);
    onClose();
  };

  const canRun = into === 'new' ? (single ? !!title.trim() : true) : single ? !!existingId : true;

  return (
    <Modal
      title={single ? `Copy “${playlists[0].title}”` : `Copy ${plural(playlists.length, 'playlist')}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={run} disabled={!canRun}>Copy to {targetName}</button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          To account
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.id === acct!.id ? ' (this account: duplicate)' : ''}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="seg">
        <button className={into === 'new' ? 'on' : ''} onClick={() => setInto('new')}>As a new playlist</button>
        <button className={into === 'existing' ? 'on' : ''} onClick={() => setInto('existing')}>Into an existing playlist</button>
      </div>
      <div className="form-grid">
        {into === 'new' && single && (
          <label>
            Name
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        {into === 'new' && !single && (
          <label>
            Add to names (optional)
            <input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder={sameAcct ? ' (copy)' : ''} />
          </label>
        )}
        {into === 'existing' && single && (
          <label>
            {targetName}'s playlist
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)} disabled={!targetLists}>
              <option value="">{targetLists ? 'Choose a playlist…' : 'Loading…'}</option>
              {targetLists
                ?.filter((p) => !(sameAcct && p.ratingKey === playlists[0].ratingKey))
                .map((p) => (
                  <option key={p.ratingKey} value={p.ratingKey}>{p.title} ({p.leafCount})</option>
                ))}
            </select>
          </label>
        )}
        {into === 'existing' && (
          <label className="check-row">
            <span>
              <input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} /> Skip titles already in the playlist
            </span>
          </label>
        )}
      </div>
      <p className="muted small">
        {into === 'existing' && !single
          ? `Each playlist is added into ${targetName}'s playlist with the same name; any without a match are created new. `
          : ''}
        Copies keep the item order. Smart playlists are copied as regular playlists holding their current items.
        {into === 'new' && sameAcct && single && title.trim() === playlists[0].title ? ' The copy will have the same name as the original.' : ''}
      </p>
    </Modal>
  );
}
