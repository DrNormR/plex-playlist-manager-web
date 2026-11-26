import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Collection, Item, Library, Playlist } from '../types';
import { Modal } from './Modal';
import { AddModeSelect, hasGroups, resolveForAdd, useAddMode } from './addMode';
import { plural, cmpText } from '../util';

/**
 * "Add these items to…" dialog. Pick an account (playlists are per account),
 * tick any number of existing playlists/collections, and/or create a new one.
 */
export function TargetPicker({ kind: initialKind, switchable, items, defaultTitle, onClose, onDone }: {
  kind: 'playlist' | 'collection';
  /** Let the user choose between adding to a playlist or a collection. */
  switchable?: boolean;
  items: Pick<Item, 'ratingKey' | 'type'>[];
  defaultTitle?: string;
  onClose: () => void;
  onDone?: (acctId: string, targetIds: string[]) => void;
}) {
  const { accounts, acct, notify, busy } = useApp();
  const [kind, setKind] = useState(initialKind);
  const [acctId, setAcctId] = useState(acct?.id ?? accounts[0]?.id ?? '');
  const [lists, setLists] = useState<(Playlist | Collection)[] | null>(null);
  const [libs, setLibs] = useState<Library[]>([]);
  const [sec, setSec] = useState('');
  const [filter, setFilter] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [makeNew, setMakeNew] = useState(false);
  const [newTitle, setNewTitle] = useState(defaultTitle ?? '');
  const [error, setError] = useState('');
  const [mode, setMode] = useAddMode();
  const itemType = items[0]?.type ?? 'movie';
  const showMode = kind === 'playlist' && hasGroups(items);

  useEffect(() => {
    if (kind !== 'collection' || !acctId) return;
    api.libraries(acctId).then((l) => {
      const want = ['movie', 'show', 'season', 'episode'].includes(itemType)
        ? itemType === 'movie' ? 'movie' : 'show'
        : ['artist', 'album', 'track'].includes(itemType) ? 'artist' : 'photo';
      const fit = l.filter((x) => x.type === want);
      setLibs(fit.length ? fit : l);
      setSec((fit[0] ?? l[0])?.key ?? '');
    }, (e) => setError(errMsg(e)));
  }, [kind, acctId, itemType]);

  useEffect(() => {
    setLists(null);
    setError('');
    setChecked(new Set());
    if (!acctId) return;
    const p = kind === 'playlist' ? api.playlists(acctId) : sec ? api.collections(acctId, sec) : null;
    p?.then((l) => setLists(l.filter((x) => !x.smart).sort((a, b) => cmpText(a.title, b.title))), (e) => setError(errMsg(e)));
  }, [kind, acctId, sec]);

  const shown = useMemo(
    () => (lists ?? []).filter((l) => l.title.toLowerCase().includes(filter.trim().toLowerCase())),
    [lists, filter],
  );

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const targetCount = checked.size + (makeNew ? 1 : 0);

  const submit = async () => {
    if (makeNew && !newTitle.trim()) return notify(`Give the new ${kind} a name`, 'error');
    const res = await busy('Adding to Plex…', async () => {
      const { keys, itemType: addType, skipped } =
        kind === 'playlist' ? await resolveForAdd(acctId, items, mode) : { keys: items.map((i) => i.ratingKey), itemType, skipped: 0 };
      if (!keys.length) throw new Error('Nothing to add: those shows have no episodes yet.');
      const done: string[] = [];
      const failed: string[] = [];
      for (const id of checked) {
        const name = lists?.find((l) => l.ratingKey === id)?.title ?? id;
        try {
          if (kind === 'playlist') await api.addToPlaylist(acctId, id, keys);
          else await api.addToCollection(acctId, id, keys);
          done.push(id);
        } catch (e) {
          failed.push(`${name}: ${errMsg(e)}`);
        }
      }
      if (makeNew) {
        try {
          const created =
            kind === 'playlist'
              ? await api.createPlaylist(acctId, newTitle.trim(), keys, addType)
              : await api.createCollection(acctId, sec, newTitle.trim(), keys, itemType);
          done.push(created.ratingKey);
        } catch (e) {
          failed.push(`New ${kind}: ${errMsg(e)}`);
        }
      }
      return { done, failed, count: keys.length, skipped };
    });
    if (!res) return;
    const who = acctId !== acct?.id ? ` for ${accounts.find((a) => a.id === acctId)?.name}` : '';
    if (res.done.length) {
      notify(
        `Added ${plural(res.count, kind === 'playlist' && showMode && mode !== 'all' ? 'episode' : 'item')} to ${plural(res.done.length, kind)}${who}` +
          (res.skipped ? ` (${res.skipped} with no episodes skipped)` : ''),
        'ok',
      );
      onDone?.(acctId, res.done);
    }
    if (res.failed.length) notify(`Some failed: ${res.failed.join('; ')}`, 'error');
    if (!res.failed.length) onClose();
  };

  return (
    <Modal
      title={`Add ${plural(items.length, 'item')} to ${kind === 'playlist' ? 'playlists' : 'collections'}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small grow">{targetCount ? `${plural(targetCount, kind)} selected` : `Tick one or more ${kind}s`}</span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!acctId || !targetCount || (kind === 'collection' && !sec)}>
            Add to {targetCount || ''} {targetCount === 1 ? kind : `${kind}s`}
          </button>
        </>
      }
    >
      {switchable && (
        <div className="seg">
          <button className={kind === 'playlist' ? 'on' : ''} onClick={() => setKind('playlist')}>Playlists</button>
          <button className={kind === 'collection' ? 'on' : ''} onClick={() => setKind('collection')}>Collections</button>
        </div>
      )}
      <div className="form-grid">
        <label>
          Account
          <select value={acctId} onChange={(e) => setAcctId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {kind === 'collection' && (
          <label>
            Library
            <select value={sec} onChange={(e) => setSec(e.target.value)}>
              {libs.map((l) => (
                <option key={l.key} value={l.key}>{l.title}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {showMode && (
        <div className="mode-row">
          <AddModeSelect mode={mode} onChange={setMode} />
          {mode === 'next' && <span className="muted small">uses {accounts.find((a) => a.id === acctId)?.name}'s watch history</span>}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="pick-list">
        <label className={`pick ${makeNew ? 'on' : ''}`}>
          <input type="checkbox" checked={makeNew} onChange={(e) => setMakeNew(e.target.checked)} />
          <span>New {kind}:</span>
          <input
            className="grow"
            value={newTitle}
            onChange={(e) => {
              setNewTitle(e.target.value);
              setMakeNew(!!e.target.value.trim());
            }}
            placeholder={`Name for a new ${kind}`}
          />
        </label>
        <div className="row-tools pick-tools">
          <input className="filter" placeholder={`Find ${kind}s…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {checked.size > 0 && <button className="link" onClick={() => setChecked(new Set())}>clear ({checked.size})</button>}
        </div>
        <div className="pick-scroll">
          {lists === null && !error && <div className="muted pad">Loading…</div>}
          {shown.map((l) => (
            <label key={l.ratingKey} className={`pick ${checked.has(l.ratingKey) ? 'on' : ''}`}>
              <input type="checkbox" checked={checked.has(l.ratingKey)} onChange={() => toggle(l.ratingKey)} />
              <span className="grow">{l.title}</span>
              <span className="muted small">{l.leafCount}</span>
            </label>
          ))}
          {lists && !shown.length && <div className="muted pad">No {kind}s match.</div>}
        </div>
      </div>
    </Modal>
  );
}
