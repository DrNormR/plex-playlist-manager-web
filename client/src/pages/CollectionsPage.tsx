import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Collection, Item, Library } from '../types';
import { ItemEditor } from '../components/ItemEditor';
import { AddItemsDialog } from '../components/AddItemsDialog';
import { TargetPicker } from '../components/TargetPicker';
import { Thumb } from '../components/Thumb';
import { ArtworkDialog } from '../components/ArtworkDialog';
import { RenameDialog } from './PlaylistsPage';
import { cmpText, plural } from '../util';

const SORT_LABEL: Record<string, string> = { '0': 'release date', '1': 'title', '2': 'custom' };

export function CollectionsPage() {
  const { acct, notify, busy, confirmLeave } = useApp();
  const acctId = acct!.id;
  const [libs, setLibs] = useState<Library[]>([]);
  const [sec, setSec] = useState(() => localStorage.getItem(`ppm.lib.${acctId}`) ?? '');
  const [lists, setLists] = useState<Collection[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'name' | 'size' | 'updated'>('name');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ collection: Collection; items: Item[] } | null>(null);
  const [dialog, setDialog] = useState<null | 'add' | 'rename' | 'art' | { copy: Item[] }>(null);

  useEffect(() => {
    setLibs([]);
    setOpen(null);
    setOpenId(null);
    api.libraries(acctId).then(
      (l) => {
        const usable = l.filter((x) => x.type !== 'photo');
        setLibs(usable);
        setSec((s) => (usable.some((x) => x.key === s) ? s : (usable[0]?.key ?? '')));
      },
      (e) => setError(errMsg(e)),
    );
  }, [acctId]);

  const loadLists = useCallback(async () => {
    if (!sec) return;
    setLists(null);
    try {
      setLists(await api.collections(acctId, sec));
      setError('');
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'PLEX_AUTH'
          ? `${acct!.name} isn't allowed to manage collections. Collections belong to the library, so switch to the server admin account.`
          : errMsg(e),
      );
      setLists([]);
    }
  }, [acctId, sec, acct]);

  useEffect(() => {
    if (sec) localStorage.setItem(`ppm.lib.${acctId}`, sec);
    setChecked(new Set());
    loadLists();
  }, [sec, acctId, loadLists]);

  const loadOpen = useCallback(async (id: string) => {
    try {
      setOpen(await api.collection(acctId, id));
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  }, [acctId, notify]);

  useEffect(() => {
    if (openId) loadOpen(openId);
  }, [openId, loadOpen]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const l = (lists ?? []).filter((c) => c.title.toLowerCase().includes(f));
    if (sort === 'name') l.sort((a, b) => cmpText(a.title, b.title));
    if (sort === 'size') l.sort((a, b) => b.leafCount - a.leafCount);
    if (sort === 'updated') l.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return l;
  }, [lists, filter, sort]);

  const deleteCols = async (ids: string[]) => {
    const names = ids.map((id) => lists?.find((l) => l.ratingKey === id)?.title).filter(Boolean);
    if (!confirm(`Delete ${plural(ids.length, 'collection')}? The movies and shows stay in your library.\n\n${names.slice(0, 15).join('\n')}${names.length > 15 ? '\n…' : ''}`)) return;
    const ok = await busy('Deleting collections…', async () => {
      for (const id of ids) await api.deleteCollection(acctId, id);
      return true;
    });
    if (!ok) return;
    if (ids.includes(openId ?? '')) {
      setOpen(null);
      setOpenId(null);
    }
    setChecked(new Set());
    notify(`Deleted ${plural(ids.length, 'collection')}`, 'ok');
    loadLists();
  };

  const c = open?.collection;

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="side-tools">
          <select
            value={sec}
            onChange={(e) => confirmLeave() && (setOpen(null), setOpenId(null), setSec(e.target.value))}
            aria-label="Library"
          >
            {libs.map((l) => (
              <option key={l.key} value={l.key}>{l.title}</option>
            ))}
          </select>
          <input className="filter" placeholder={`Filter ${lists ? plural(lists.length, 'collection') : 'collections'}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="row-tools">
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort collections">
              <option value="name">Name</option>
              <option value="size">Most items</option>
              <option value="updated">Recently changed</option>
            </select>
            <button className="icon" onClick={loadLists} title="Reload">↻</button>
          </div>
          {checked.size > 0 && (
            <div className="bulk">
              <span>{checked.size} checked</span>
              <button className="danger" onClick={() => deleteCols([...checked])}>Delete</button>
              <button className="link" onClick={() => setChecked(new Set())}>clear</button>
            </div>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="side-list">
          {lists === null && sec && <div className="muted pad">Loading collections…</div>}
          {shown.map((l) => (
            <div
              key={l.ratingKey}
              className={`side-item ${openId === l.ratingKey ? 'active' : ''}`}
              onClick={() => l.ratingKey !== openId && confirmLeave() && setOpenId(l.ratingKey)}
            >
              <input
                type="checkbox"
                checked={checked.has(l.ratingKey)}
                onClick={(e) => e.stopPropagation()}
                onChange={() =>
                  setChecked((s) => {
                    const n = new Set(s);
                    if (n.has(l.ratingKey)) n.delete(l.ratingKey);
                    else n.add(l.ratingKey);
                    return n;
                  })
                }
                aria-label={`Check ${l.title}`}
              />
              <Thumb acct={acctId} path={l.thumb} w={24} h={36} />
              <span className="grow ellipsis" title={l.title}>{l.title}</span>
              {l.smart && <span className="tag">smart</span>}
              <span className="muted small">{l.leafCount}</span>
            </div>
          ))}
          {lists && !shown.length && !error && <div className="muted pad">No collections.</div>}
        </div>
      </aside>

      <main className="main">
        {!open && <div className="empty-state big">Pick a collection on the left.</div>}
        {open && c && (
          <ItemEditor
            key={c.ratingKey}
            mode="collection"
            acctId={acctId}
            items={open.items}
            readOnly={c.smart}
            readOnlyReason="Smart collections are built from filters in Plex, so they can't be edited here."
            onApply={async (remove, order) => {
              const r = await api.applyCollection(acctId, c.ratingKey, remove, order);
              setOpen({ collection: { ...c, collectionSort: '2', leafCount: r.items.length }, items: r.items });
              setLists((ls) => ls?.map((x) => (x.ratingKey === c.ratingKey ? { ...x, leafCount: r.items.length } : x)) ?? ls);
              return r.items;
            }}
            onAddClick={() => setDialog('add')}
            onCopySelected={(items) => setDialog({ copy: items })}
            header={
              <div className="title-row">
                <h1>{c.title}</h1>
                <span className="muted small" title="Saving a new order switches the collection to custom order">
                  Sorted by {SORT_LABEL[c.collectionSort ?? ''] ?? 'library default'}
                </span>
                <span className="spacer" />
                <button onClick={() => setDialog('rename')}>Rename</button>
                <button onClick={() => setDialog('art')}>Artwork…</button>
                <button onClick={() => loadOpen(c.ratingKey)} title="Reload from Plex">↻</button>
                <button className="danger" onClick={() => deleteCols([c.ratingKey])}>Delete</button>
              </div>
            }
          />
        )}
      </main>

      {dialog === 'add' && open && (
        <AddItemsDialog
          acctId={acctId}
          title={open.collection.title}
          existing={new Set(open.items.map((i) => i.ratingKey))}
          onClose={() => setDialog(null)}
          onAdd={async (items) => {
            const ok = await busy('Adding…', () => api.addToCollection(acctId, open.collection.ratingKey, items.map((i) => i.ratingKey)));
            if (ok) {
              notify(`Added ${plural(items.length, 'title')}`, 'ok');
              await loadOpen(open.collection.ratingKey);
              loadLists();
            }
            return !!ok;
          }}
        />
      )}
      {dialog && typeof dialog === 'object' && (
        <TargetPicker
          kind="playlist"
          switchable
          items={dialog.copy}
          onClose={() => setDialog(null)}
          onDone={() => loadLists()}
        />
      )}
      {dialog === 'art' && c && (
        <ArtworkDialog
          acctId={acctId}
          ratingKey={c.ratingKey}
          title={c.title}
          itemType="collection"
          onClose={() => setDialog(null)}
          onChanged={() => loadLists()}
        />
      )}
      {dialog === 'rename' && c && (
        <RenameDialog
          current={c.title}
          onClose={() => setDialog(null)}
          onSave={async (title) => {
            const ok = await busy('Renaming…', () => api.renameCollection(acctId, c.ratingKey, title));
            if (ok) {
              setOpen((o) => (o ? { ...o, collection: { ...o.collection, title } } : o));
              setLists((ls) => ls?.map((x) => (x.ratingKey === c.ratingKey ? { ...x, title } : x)) ?? ls);
              setDialog(null);
            }
          }}
        />
      )}
    </div>
  );
}
