import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Collection, Library, Playlist } from '../types';
import { Modal } from './Modal';
import { plural, cmpText } from '../util';

/**
 * "Add these items to…" dialog. Pick an account (playlists are per account)
 * and an existing playlist/collection, or create a new one.
 */
export function TargetPicker({ kind: initialKind, switchable, ratingKeys, itemType, defaultTitle, onClose, onDone }: {
  kind: 'playlist' | 'collection';
  /** Let the user choose between adding to a playlist or a collection. */
  switchable?: boolean;
  ratingKeys: string[];
  itemType: string;
  defaultTitle?: string;
  onClose: () => void;
  onDone?: (acctId: string, targetId: string) => void;
}) {
  const { accounts, acct, notify, busy } = useApp();
  const [kind, setKind] = useState(initialKind);
  const [acctId, setAcctId] = useState(acct?.id ?? accounts[0]?.id ?? '');
  const [lists, setLists] = useState<(Playlist | Collection)[] | null>(null);
  const [libs, setLibs] = useState<Library[]>([]);
  const [sec, setSec] = useState('');
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<string>('new');
  const [newTitle, setNewTitle] = useState(defaultTitle ?? '');
  const [error, setError] = useState('');

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
    setTarget('new');
    if (!acctId) return;
    const p = kind === 'playlist' ? api.playlists(acctId) : sec ? api.collections(acctId, sec) : null;
    p?.then((l) => setLists(l.filter((x) => !x.smart).sort((a, b) => cmpText(a.title, b.title))), (e) => setError(errMsg(e)));
  }, [kind, acctId, sec]);

  const shown = useMemo(
    () => (lists ?? []).filter((l) => l.title.toLowerCase().includes(filter.trim().toLowerCase())),
    [lists, filter],
  );

  const submit = async () => {
    const ok = await busy('Adding to Plex…', async () => {
      if (target === 'new') {
        if (!newTitle.trim()) throw new Error('Give the new list a name');
        const created =
          kind === 'playlist'
            ? await api.createPlaylist(acctId, newTitle.trim(), ratingKeys, itemType)
            : await api.createCollection(acctId, sec, newTitle.trim(), ratingKeys, itemType);
        return created.ratingKey;
      }
      if (kind === 'playlist') await api.addToPlaylist(acctId, target, ratingKeys);
      else await api.addToCollection(acctId, target, ratingKeys);
      return target;
    });
    if (ok) {
      const who = accounts.find((a) => a.id === acctId)?.name;
      notify(`Added ${plural(ratingKeys.length, 'item')}${kind === 'playlist' && acctId !== acct?.id ? ` for ${who}` : ''}`, 'ok');
      onDone?.(acctId, ok);
      onClose();
    }
  };

  return (
    <Modal
      title={`Add ${plural(ratingKeys.length, 'item')} to a ${kind}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!acctId || (kind === 'collection' && !sec)}>
            {target === 'new' ? `Create ${kind}` : 'Add'}
          </button>
        </>
      }
    >
      {switchable && (
        <div className="seg">
          <button className={kind === 'playlist' ? 'on' : ''} onClick={() => setKind('playlist')}>Playlist</button>
          <button className={kind === 'collection' ? 'on' : ''} onClick={() => setKind('collection')}>Collection</button>
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
      {error && <div className="banner error">{error}</div>}
      <div className="pick-list">
        <label className={`pick ${target === 'new' ? 'on' : ''}`}>
          <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} />
          <span>New {kind}:</span>
          <input
            className="grow"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onFocus={() => setTarget('new')}
            placeholder={`Name for the new ${kind}`}
          />
        </label>
        <input className="filter" placeholder={`Find an existing ${kind}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="pick-scroll">
          {lists === null && !error && <div className="muted">Loading…</div>}
          {shown.map((l) => (
            <label key={l.ratingKey} className={`pick ${target === l.ratingKey ? 'on' : ''}`}>
              <input type="radio" checked={target === l.ratingKey} onChange={() => setTarget(l.ratingKey)} />
              <span className="grow">{l.title}</span>
              <span className="muted small">{l.leafCount}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
