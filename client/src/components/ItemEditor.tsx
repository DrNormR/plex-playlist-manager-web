import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Item } from '../types';
import { SORTS, fmtDuration, plural, sortItems, TYPE_LABEL, type SortKey } from '../util';
import { Thumb } from './Thumb';
import { useApp } from '../ctx';

interface Props {
  mode: 'playlist' | 'collection';
  acctId: string;
  items: Item[];
  readOnly?: boolean;
  readOnlyReason?: string;
  /** Persist removals + new order; returns the server's resulting list. */
  onApply: (remove: string[], order: string[]) => Promise<Item[]>;
  onAddClick?: () => void;
  onCopySelected?: (items: Item[]) => void;
  header?: ReactNode;
}

interface Snapshot {
  draft: Item[];
  removed: Item[];
}

export function ItemEditor({ mode, acctId, items, readOnly, readOnlyReason, onApply, onAddClick, onCopySelected, header }: Props) {
  const { setDirty, notify, busy } = useApp();
  const keyOf = useCallback((i: Item) => (mode === 'playlist' ? i.playlistItemID! : i.ratingKey), [mode]);

  const [draft, setDraft] = useState<Item[]>(items);
  const [removed, setRemoved] = useState<Item[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [posInput, setPosInput] = useState('');
  const baseOrder = useRef(items.map(keyOf).join('|'));

  const dirty = removed.length > 0 || draft.map(keyOf).join('|') !== baseOrder.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  // New server data: reset when clean; when there are unsaved edits (e.g. items were just added), keep them.
  useEffect(() => {
    baseOrder.current = items.map(keyOf).join('|');
    setDraft((d) => {
      const fresh = new Map(items.map((i) => [keyOf(i), i]));
      const removedKeys = new Set(removed.map(keyOf));
      const kept = d.filter((i) => fresh.has(keyOf(i))).map((i) => fresh.get(keyOf(i))!);
      const keptKeys = new Set(kept.map(keyOf));
      const added = items.filter((i) => !keptKeys.has(keyOf(i)) && !removedKeys.has(keyOf(i)));
      return d.length === 0 || !dirtyRef.current ? items : [...kept, ...added];
    });
    setRemoved((r) => r.filter((i) => items.some((x) => keyOf(x) === keyOf(i))));
    setSelected((s) => new Set([...s].filter((k) => items.some((x) => keyOf(x) === k))));
    if (!dirtyRef.current) setHistory([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const commit = (next: Item[], nextRemoved: Item[] = removed) => {
    setHistory((h) => [...h.slice(-49), { draft, removed }]);
    setDraft(next);
    setRemoved(nextRemoved);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setDraft(last.draft);
    setRemoved(last.removed);
  };
  const discard = () => {
    setDraft(items);
    setRemoved([]);
    setHistory([]);
    setSelected(new Set());
  };

  const q = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? draft.filter((i) => `${i.displayTitle} ${i.year ?? ''} ${i.library ?? ''}`.toLowerCase().includes(q)) : draft),
    [draft, q],
  );
  const positions = useMemo(() => new Map(draft.map((i, n) => [keyOf(i), n + 1])), [draft, keyOf]);
  const selItems = draft.filter((i) => selected.has(keyOf(i)));
  const totalDuration = draft.reduce((s, i) => s + (i.duration ?? 0), 0);

  // ---- selection
  const onRowClick = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor) {
      const ids = visible.map(keyOf);
      const [x, y] = [ids.indexOf(anchor), ids.indexOf(key)].sort((m, n) => m - n);
      const range = ids.slice(x, y + 1);
      setSelected((s) => new Set(e.ctrlKey || e.metaKey ? [...s, ...range] : range));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      });
    } else {
      setSelected(new Set([key]));
    }
    setAnchor(key);
  };
  const toggleCheck = (key: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    setAnchor(key);
  };
  const selectAllVisible = () => setSelected(new Set(visible.map(keyOf)));

  // ---- edits
  const moveSelected = (where: 'top' | 'bottom' | 'up' | 'down' | number) => {
    if (!selected.size) return;
    const block = draft.filter((i) => selected.has(keyOf(i)));
    const rest = draft.filter((i) => !selected.has(keyOf(i)));
    let next: Item[];
    if (where === 'top') next = [...block, ...rest];
    else if (where === 'bottom') next = [...rest, ...block];
    else if (typeof where === 'number') {
      const at = Math.max(0, Math.min(rest.length, where - 1));
      next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
    } else {
      next = [...draft];
      const idxs = next.map((i, n) => (selected.has(keyOf(i)) ? n : -1)).filter((n) => n >= 0);
      if (where === 'up') {
        for (const n of idxs) if (n > 0 && !selected.has(keyOf(next[n - 1]))) [next[n - 1], next[n]] = [next[n], next[n - 1]];
      } else {
        for (const n of idxs.reverse()) if (n < next.length - 1 && !selected.has(keyOf(next[n + 1]))) [next[n + 1], next[n]] = [next[n], next[n + 1]];
      }
    }
    commit(next);
  };
  const removeKeys = (ks: Set<string>, label: string) => {
    if (!ks.size) return notify(`No ${label} to remove`);
    const gone = draft.filter((i) => ks.has(keyOf(i)));
    commit(draft.filter((i) => !ks.has(keyOf(i))), [...removed, ...gone]);
    setSelected(new Set());
    notify(`${plural(gone.length, 'item')} marked for removal. Save to apply.`);
  };
  const removeSelected = () => removeKeys(new Set(selected), 'selected items');
  const removeDuplicates = () => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const i of draft) {
      if (seen.has(i.ratingKey)) dup.add(keyOf(i));
      seen.add(i.ratingKey);
    }
    removeKeys(dup, 'duplicates');
  };
  const removeWatched = () => removeKeys(new Set(draft.filter((i) => i.viewCount).map(keyOf)), 'watched items');
  const applySort = (k: SortKey) => commit(sortItems(draft, k));
  const sortSelectionOnly = (k: SortKey) => {
    // Sort just the selected rows, keeping them in the slots they occupy.
    const slots = draft.map((i, n) => (selected.has(keyOf(i)) ? n : -1)).filter((n) => n >= 0);
    const sorted = sortItems(slots.map((n) => draft[n]), k);
    const next = [...draft];
    slots.forEach((n, j) => (next[n] = sorted[j]));
    commit(next);
  };

  const save = async () => {
    const res = await busy(`Saving ${mode}…`, () => onApply(removed.map(keyOf), draft.map(keyOf)));
    if (!res) return;
    baseOrder.current = res.map(keyOf).join('|');
    setRemoved([]);
    setHistory([]);
    setDraft(res);
    notify('Saved to Plex', 'ok');
  };

  // ---- drag & drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragId(id);
    if (!selected.has(id)) setSelected(new Set([id]));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = draft.map(keyOf);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (selected.has(String(active.id)) && selected.size > 1) {
      if (selected.has(String(over.id))) return;
      const block = draft.filter((i) => selected.has(keyOf(i)));
      const rest = draft.filter((i) => !selected.has(keyOf(i)));
      let at = rest.findIndex((i) => keyOf(i) === String(over.id));
      if (to > from) at += 1;
      commit([...rest.slice(0, at), ...block, ...rest.slice(at)]);
    } else {
      commit(arrayMove(draft, from, to));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (readOnly) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllVisible();
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelected('up');
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelected('down');
    }
  };

  const dragging = dragId ? draft.find((i) => keyOf(i) === dragId) : undefined;
  const canDrag = !readOnly && !q;

  return (
    <div className="editor" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="editor-head">
        {header}
        <div className="muted small">
          {plural(draft.length, 'item')}
          {totalDuration ? ` · ${fmtDuration(totalDuration)}` : ''}
          {selected.size ? ` · ${selected.size} selected` : ''}
        </div>
      </div>

      {readOnly ? (
        <div className="banner">{readOnlyReason ?? 'This list is read-only.'}</div>
      ) : (
        <div className="toolbar">
          <div className="group">
            <select
              value=""
              onChange={(e) => {
                const k = e.target.value as SortKey;
                if (k) (selected.size > 1 ? sortSelectionOnly : applySort)(k);
              }}
              title={selected.size > 1 ? 'Sorts only the selected rows' : 'Sorts the whole list'}
            >
              <option value="">{selected.size > 1 ? `Sort ${selected.size} selected…` : 'Sort all…'}</option>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="group" aria-label="Move selected">
            <button disabled={!selected.size} onClick={() => moveSelected('top')} title="Move selected to top">⤒ Top</button>
            <button disabled={!selected.size} onClick={() => moveSelected('up')} title="Move selected up (Alt+↑)">↑</button>
            <button disabled={!selected.size} onClick={() => moveSelected('down')} title="Move selected down (Alt+↓)">↓</button>
            <button disabled={!selected.size} onClick={() => moveSelected('bottom')} title="Move selected to bottom">⤓ Bottom</button>
            <form
              className="pos"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(posInput, 10);
                if (n > 0) moveSelected(n);
                setPosInput('');
              }}
            >
              <input
                value={posInput}
                onChange={(e) => setPosInput(e.target.value.replace(/\D/g, ''))}
                placeholder="#"
                disabled={!selected.size}
                aria-label="Move selected to position"
                title="Type a position and press Enter"
              />
            </form>
          </div>
          <div className="group">
            <button disabled={!selected.size} onClick={removeSelected} title="Remove selected (Delete)">Remove</button>
            {mode === 'playlist' && <button onClick={removeDuplicates}>Remove duplicates</button>}
            {mode === 'playlist' && <button onClick={removeWatched} title="Watched by the current account">Remove watched</button>}
          </div>
          <div className="group">
            {onCopySelected && (
              <button disabled={!selected.size} onClick={() => onCopySelected(selItems)}>Copy selected to…</button>
            )}
            {onAddClick && <button onClick={onAddClick}>+ Add items</button>}
          </div>
          <div className="spacer" />
          <div className="group">
            <button disabled={!history.length} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
            <button disabled={!dirty} onClick={discard}>Discard</button>
            <button className="primary" disabled={!dirty} onClick={save}>
              Save{removed.length ? ` (−${removed.length})` : ''}
            </button>
          </div>
        </div>
      )}

      <div className="filter-row">
        <input className="filter" placeholder="Filter this list…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="link" onClick={selectAllVisible}>Select all{q ? ' shown' : ''}</button>
        <button className="link" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear selection</button>
        {q && <span className="muted small">Drag-and-drop is off while filtering; the move buttons still work.</span>}
      </div>

      <div className="rows" role="listbox" aria-multiselectable="true">
        <div className="row head">
          <span />
          <span className="num">#</span>
          <span />
          <span />
          <span>Title</span>
          <span>Year</span>
          <span>Type</span>
          <span>Library</span>
          <span className="right">Length</span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
          <SortableContext items={visible.map(keyOf)} strategy={verticalListSortingStrategy}>
            {visible.map((i) => (
              <Row
                key={keyOf(i)}
                id={keyOf(i)}
                item={i}
                pos={positions.get(keyOf(i))!}
                acctId={acctId}
                selected={selected.has(keyOf(i))}
                canDrag={canDrag}
                ghost={!!dragId && selected.size > 1 && selected.has(keyOf(i)) && keyOf(i) !== dragId}
                onClick={onRowClick}
                onCheck={toggleCheck}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {dragging && (
              <div className="drag-overlay">
                {selected.size > 1 ? `Moving ${selected.size} items` : dragging.displayTitle}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {!visible.length && <div className="empty-state">{draft.length ? 'Nothing matches the filter.' : 'This list is empty.'}</div>}
      </div>

      {removed.length > 0 && (
        <details className="removed">
          <summary>{plural(removed.length, 'item')} will be removed when you save</summary>
          <ul>
            {removed.map((i) => (
              <li key={keyOf(i)}>
                {i.displayTitle}{' '}
                <button
                  className="link"
                  onClick={() => commit([...draft, i], removed.filter((x) => keyOf(x) !== keyOf(i)))}
                >
                  restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const Row = memo(function Row({ id, item, pos, acctId, selected, canDrag, ghost, onClick, onCheck }: {
  id: string;
  item: Item;
  pos: number;
  acctId: string;
  selected: boolean;
  canDrag: boolean;
  ghost: boolean;
  onClick: (e: React.MouseEvent, key: string) => void;
  onCheck: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !canDrag });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`row ${selected ? 'selected' : ''} ${isDragging || ghost ? 'dragging' : ''}`}
      onClick={(e) => onClick(e, id)}
      role="option"
      aria-selected={selected}
    >
      <span className={`handle ${canDrag ? '' : 'off'}`} {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} title="Drag to reorder">
        ⋮⋮
      </span>
      <span className="num">{pos}</span>
      <input type="checkbox" checked={selected} onChange={() => onCheck(id)} onClick={(e) => e.stopPropagation()} aria-label="Select" />
      <Thumb acct={acctId} path={item.thumb} w={26} h={39} square={item.type === 'track' || item.type === 'album'} />
      <span className="title" title={item.displayTitle}>
        {item.displayTitle}
        {item.viewCount ? <span className="watched" title="Watched">✓</span> : null}
      </span>
      <span>{item.year ?? ''}</span>
      <span className="muted">{TYPE_LABEL[item.type] ?? item.type}</span>
      <span className="muted ellipsis">{item.library ?? ''}</span>
      <span className="right muted">{fmtDuration(item.duration)}</span>
    </div>
  );
});
