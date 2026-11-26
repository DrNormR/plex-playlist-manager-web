import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { FullItem, MatchResult } from '../types';
import { Modal } from './Modal';
import { Thumb } from './Thumb';
import { TYPE_LABEL, fmtDuration } from '../util';

export type EditTab = 'general' | 'tags' | 'match' | 'info';

const FIELD_LABEL: Record<string, string> = {
  title: 'Title', titleSort: 'Sort title', originalTitle: 'Original title', editionTitle: 'Edition',
  originallyAvailableAt: 'Release date', year: 'Year', contentRating: 'Content rating', studio: 'Studio',
  tagline: 'Tagline', summary: 'Summary',
};
const FIELDS_BY_TYPE: Record<string, string[]> = {
  movie: ['title', 'titleSort', 'originalTitle', 'editionTitle', 'originallyAvailableAt', 'year', 'contentRating', 'studio', 'tagline', 'summary'],
  show: ['title', 'titleSort', 'originalTitle', 'originallyAvailableAt', 'contentRating', 'studio', 'tagline', 'summary'],
  season: ['title', 'summary'],
  episode: ['title', 'titleSort', 'originallyAvailableAt', 'contentRating', 'summary'],
  artist: ['title', 'titleSort', 'summary'],
  album: ['title', 'titleSort', 'originallyAvailableAt', 'studio', 'summary'],
  track: ['title', 'titleSort', 'originalTitle', 'summary'],
};
const TAG_LABEL: Record<string, string> = {
  genre: 'Genres', label: 'Labels', collection: 'Collections', director: 'Directors', writer: 'Writers',
  producer: 'Producers', country: 'Countries', style: 'Styles', mood: 'Moods',
};
const TAGS_BY_TYPE: Record<string, string[]> = {
  movie: ['genre', 'label', 'collection', 'director', 'writer', 'producer', 'country'],
  show: ['genre', 'label', 'collection'],
  season: ['label'],
  episode: ['director', 'writer', 'label'],
  artist: ['genre', 'style', 'mood', 'country', 'label', 'collection'],
  album: ['genre', 'style', 'mood', 'label', 'collection'],
  track: ['mood', 'label'],
};
const MATCHABLE = ['movie', 'show', 'artist', 'album'];

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function EditDialog({ acctId, ratingKey: initialRk, title, type, initialTab = 'general', onClose, onSaved, onReplaced }: {
  acctId: string;
  ratingKey: string;
  title: string;
  type: string;
  initialTab?: EditTab;
  onClose: () => void;
  /** Called with the fresh item after anything was saved, matched or refreshed. */
  onSaved?: (item: FullItem) => void;
  /** Plex merged this item into another one (matching to a title already in the library). */
  onReplaced?: (oldRatingKey: string, item: FullItem) => void;
}) {
  const [ratingKey, setRatingKey] = useState(initialRk);
  const { acct, notify, busy } = useApp();
  const canEdit = !!acct?.admin;
  const [tab, setTab] = useState<EditTab>(canEdit ? initialTab : 'info');
  const [full, setFull] = useState<FullItem | null>(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Record<string, string[]>>({});

  const fieldList = FIELDS_BY_TYPE[type] ?? ['title', 'summary'];
  const tagList = TAGS_BY_TYPE[type] ?? [];

  const reset = (f: FullItem) => {
    setFull(f);
    setFields(Object.fromEntries(fieldList.map((k) => [k, f.fields[k] ?? ''])));
    setLocks(new Set(f.locked));
    setTags(Object.fromEntries(tagList.map((k) => [k, f.tags[k] ?? []])));
  };

  const load = async () => {
    try {
      const f = await api.fullItem(acctId, ratingKey);
      reset(f);
      setError('');
      return f;
    } catch (e) {
      setError(errMsg(e));
      return null;
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acctId, ratingKey]);

  const dirty = useMemo(() => {
    if (!full) return false;
    if (fieldList.some((k) => (fields[k] ?? '') !== (full.fields[k] ?? ''))) return true;
    if ([...fieldList, ...tagList].some((k) => locks.has(k) !== full.locked.includes(k))) return true;
    return tagList.some((k) => !sameList(tags[k] ?? [], full.tags[k] ?? []));
  }, [full, fields, locks, tags, fieldList, tagList]);

  const close = () => {
    if (dirty && !confirm('Discard your unsaved edits?')) return;
    onClose();
  };

  const setField = (k: string, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setLocks((l) => new Set(l).add(k)); // like Plex: editing a field locks it
  };
  const toggleLock = (k: string) =>
    setLocks((l) => {
      const n = new Set(l);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const save = async () => {
    if (!full) return;
    const changedFields = Object.fromEntries(fieldList.filter((k) => (fields[k] ?? '') !== (full.fields[k] ?? '')).map((k) => [k, fields[k] ?? '']));
    const locked = Object.fromEntries([...fieldList, ...tagList].map((k) => [k, locks.has(k)]));
    const r = await busy('Saving to Plex…', () => api.editItem(acctId, ratingKey, { fields: changedFields, locked, tags }));
    if (!r) return;
    reset(r.item);
    notify(r.changed ? 'Saved' : 'Nothing changed', 'ok');
    onSaved?.(r.item);
  };

  const after = async (msg: string) => {
    notify(msg, 'ok');
    const f = await load();
    if (f) onSaved?.(f);
  };

  const matched = async (r: { ratingKey: string; merged: boolean; title?: string; year?: number }) => {
    if (!r.merged || r.ratingKey === ratingKey) return after('Match applied. Plex is downloading the new metadata.');
    const old = ratingKey;
    const f = await api.fullItem(acctId, r.ratingKey).catch(() => null);
    setRatingKey(r.ratingKey); // the effect reloads the dialog on the new item
    const versions = f?.media.length ?? 0;
    notify(
      `Plex merged this into the existing “${r.title ?? 'title'}${r.year ? ` (${r.year})` : ''}”` +
        (versions > 1 ? `, which now has ${versions} versions. See the Info tab.` : '.'),
      'ok',
    );
    if (f) onReplaced?.(old, f);
  };

  const tabs: { id: EditTab; label: string; show: boolean }[] = [
    { id: 'general', label: 'General', show: canEdit },
    { id: 'tags', label: 'Tags', show: canEdit && tagList.length > 0 },
    { id: 'match', label: 'Match', show: canEdit && MATCHABLE.includes(type) },
    { id: 'info', label: 'Info', show: true },
  ];

  return (
    <Modal
      wide
      title={`${TYPE_LABEL[type] ?? 'Item'}: ${full?.fields.title ?? title}`}
      onClose={close}
      footer={
        tab === 'general' || tab === 'tags' ? (
          <>
            <span className="muted small grow">🔒 = locked, so Plex won't overwrite it when it refreshes metadata.</span>
            <button onClick={() => full && reset(full)} disabled={!dirty}>Undo changes</button>
            <button onClick={close}>Close</button>
            <button className="primary" onClick={save} disabled={!dirty}>Save</button>
          </>
        ) : (
          <button onClick={close}>Close</button>
        )
      }
    >
      <div className="seg tabs">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {!canEdit && <div className="banner">Editing needs the server admin account. Switch accounts in the top bar to make changes.</div>}
      {error && <div className="banner error">{/40[13]/.test(error) ? `Plex refused: this account can't see or change this item. (${error})` : error}</div>}
      {!full && !error && <div className="muted">Loading…</div>}

      {full && tab === 'general' && (
        <div className="edit-grid">
          {fieldList.map((k) => (
            <div key={k} className={`edit-row ${k === 'summary' || k === 'tagline' ? 'wide' : ''}`}>
              <label htmlFor={`f-${k}`}>{type === 'album' && k === 'studio' ? 'Record label' : FIELD_LABEL[k]}</label>
              <div className="edit-input">
                {k === 'summary' ? (
                  <textarea id={`f-${k}`} rows={6} value={fields[k] ?? ''} onChange={(e) => setField(k, e.target.value)} />
                ) : (
                  <input
                    id={`f-${k}`}
                    type={k === 'originallyAvailableAt' ? 'date' : 'text'}
                    inputMode={k === 'year' ? 'numeric' : undefined}
                    maxLength={k === 'year' ? 4 : undefined}
                    value={fields[k] ?? ''}
                    onChange={(e) => setField(k, k === 'year' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                  />
                )}
                <LockButton locked={locks.has(k)} onClick={() => toggleLock(k)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {full && tab === 'tags' && (
        <div className="edit-grid">
          {tagList.map((k) => (
            <div key={k} className="edit-row wide">
              <label>{TAG_LABEL[k]}</label>
              <div className="edit-input">
                <TagInput
                  acctId={acctId}
                  sec={full.librarySectionID}
                  field={k}
                  type={type}
                  value={tags[k] ?? []}
                  onChange={(v) => {
                    setTags((t) => ({ ...t, [k]: v }));
                    setLocks((l) => new Set(l).add(k));
                  }}
                />
                <LockButton locked={locks.has(k)} onClick={() => toggleLock(k)} />
              </div>
            </div>
          ))}
          {tagList.includes('collection') && (
            <p className="muted small">Typing a new collection name here creates that collection.</p>
          )}
        </div>
      )}

      {full && tab === 'match' && (
        <MatchTab
          acctId={acctId}
          full={full}
          onMatched={matched}
          onUnmatched={() => after('Unmatched')}
          onRefreshed={() => after('Refresh started. New metadata can take a minute to appear.')}
        />
      )}

      {full && tab === 'info' && <InfoTab full={full} />}
    </Modal>
  );
}

function LockButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`lock ${locked ? 'on' : ''}`} onClick={onClick} title={locked ? 'Locked: click to unlock' : 'Unlocked: click to lock'}>
      {locked ? '🔒' : '🔓'}
    </button>
  );
}

const suggestionCache = new Map<string, Promise<string[]>>();

function TagInput({ acctId, sec, field, type, value, onChange }: {
  acctId: string;
  sec: string;
  field: string;
  type: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listId = `dl-${field}`;

  useEffect(() => {
    const key = `${acctId}|${sec}|${field}|${type}`;
    let p = suggestionCache.get(key);
    if (!p) {
      p = api.tagValues(acctId, sec, field, type).catch(() => []);
      suggestionCache.set(key, p);
    }
    let live = true;
    p.then((s) => live && setSuggestions(s));
    return () => {
      live = false;
    };
  }, [acctId, sec, field, type]);

  const add = (raw: string) => {
    const parts = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const next = [...value];
    for (const t of parts) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    onChange(next);
    setText('');
  };

  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
      <input
        list={listId}
        value={text}
        placeholder={value.length ? '' : 'Add…'}
        onChange={(e) => {
          const v = e.target.value;
          // Picking from the suggestion list adds it right away.
          if (suggestions.includes(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function MatchTab({ acctId, full, onMatched, onUnmatched, onRefreshed }: {
  acctId: string;
  full: FullItem;
  onMatched: (r: { ratingKey: string; merged: boolean; title?: string; year?: number }) => void;
  onUnmatched: () => void;
  onRefreshed: () => void;
}) {
  const { busy } = useApp();
  const fromName = full.fromName;
  const plexTitle = full.fields.title ?? full.title;
  const plexYear = full.fields.year ?? (full.year ? String(full.year) : '');
  const [q, setQ] = useState(fromName?.title || plexTitle);
  const [year, setYear] = useState(fromName ? (fromName.year ? String(fromName.year) : '') : plexYear);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

  const search = async () => {
    setSearching(true);
    setError('');
    try {
      setResults(await api.matches(acctId, full.ratingKey, q.trim(), year.trim()));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSearching(false);
    }
  };

  const unmatched = !full.guid || full.guid.startsWith('local://');

  return (
    <div className="match-tab">
      <div className="small">
        Currently {unmatched ? <strong>unmatched</strong> : <>matched to <code>{full.guid}</code></>}
        {full.guids.length > 0 && <span className="muted"> · {full.guids.join(' · ')}</span>}
      </div>
      <form className="inline-form" onSubmit={(e) => (e.preventDefault(), search())}>
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title to search for" />
        <input className="year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Year" inputMode="numeric" />
        <button className="primary" disabled={searching || !q.trim()}>{searching ? 'Searching…' : 'Search'}</button>
      </form>
      {fromName && (
        <div className="muted small">
          From the {full.type === 'movie' ? 'file' : 'folder'} name <code>{fromName.name}</code>
          {' · '}
          <button className="link" type="button" onClick={() => (setQ(fromName.title), setYear(fromName.year ? String(fromName.year) : ''))}>
            use file name
          </button>
          {' · '}
          <button className="link" type="button" onClick={() => (setQ(plexTitle), setYear(plexYear))}>
            use current Plex title
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {results && !results.length && <div className="muted">No matches found. Try a different title or year.</div>}
      <div className="match-list">
        {results?.map((r) => (
          <div key={r.guid} className={`match ${r.matched ? 'current' : ''}`}>
            <Thumb acct={acctId} path={r.thumb} w={46} h={69} />
            <div className="grow">
              <div><strong>{r.name}</strong> {r.year ? <span className="muted">({r.year})</span> : null}</div>
              {r.summary && <div className="muted small clamp2">{r.summary}</div>}
              <div className="muted small">{r.score !== undefined ? `Score ${r.score}` : ''} · <code>{r.guid}</code></div>
            </div>
            {r.matched ? (
              <span className="tag">current</span>
            ) : (
              <button
                onClick={async () => {
                  if (!confirm(`Match “${full.title}” to “${r.name}${r.year ? ` (${r.year})` : ''}”? Plex will replace its unlocked metadata and artwork.`)) return;
                  const res = await busy('Applying match…', () => api.applyMatch(acctId, full.ratingKey, r));
                  if (res) onMatched(res);
                }}
              >
                Use this match
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="inline-form">
        <button onClick={async () => (await busy('Refreshing…', async () => (await api.refreshItem(acctId, full.ratingKey), true))) && onRefreshed()}>
          Refresh metadata
        </button>
        {!unmatched && (
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Unmatch this title? Plex removes its downloaded metadata and artwork until you match it again.')) return;
              if (await busy('Unmatching…', async () => (await api.unmatch(acctId, full.ratingKey), true))) onUnmatched();
            }}
          >
            Unmatch
          </button>
        )}
      </div>
    </div>
  );
}

function fmtSize(bytes?: number) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
const fmtDate = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString() : '');
const STREAM_KIND: Record<number, string> = { 1: 'Video', 2: 'Audio', 3: 'Subtitle', 4: 'Lyrics' };

function InfoTab({ full }: { full: FullItem }) {
  const { notify } = useApp();
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => notify('Path copied', 'ok'), () => notify('Copy failed', 'error'));

  return (
    <div className="info-tab">
      {full.media.length === 0 && full.locations.length === 0 && (
        <div className="muted">
          {['season', 'album'].includes(full.type) ? 'Files belong to the individual episodes or tracks. Open one to see its file.' : 'Plex has no file information for this item.'}
        </div>
      )}

      {full.locations.length > 0 && (
        <section>
          <h3>Folder{full.locations.length > 1 ? 's' : ''}</h3>
          {full.locations.map((l) => (
            <div key={l} className="path-row">
              <code className="path">{l}</code>
              <button className="small-btn" onClick={() => copy(l)}>Copy</button>
            </div>
          ))}
        </section>
      )}

      {full.media.map((m, n) => (
        <section key={m.id}>
          <h3>
            {full.media.length > 1 ? `Version ${n + 1}` : 'File'}
            {m.editionTitle ? ` · ${m.editionTitle}` : ''}
          </h3>
          {m.parts.map((p, i) => (
            <div key={i} className="part">
              <div className="path-row">
                <code className="path">{p.file ?? '(no path)'}</code>
                {p.file && <button className="small-btn" onClick={() => copy(p.file!)}>Copy</button>}
              </div>
              {(p.exists === false || p.accessible === false) && (
                <div className="error-text small">Plex reports this file as {p.exists === false ? 'missing' : 'not accessible'}.</div>
              )}
              <div className="info-facts">
                {[
                  m.videoResolution && `${/^\d+$/.test(m.videoResolution) ? `${m.videoResolution}p` : m.videoResolution.toUpperCase()}${m.width && m.height ? ` (${m.width}×${m.height})` : ''}`,
                  m.videoCodec?.toUpperCase(),
                  m.videoFrameRate,
                  m.audioCodec && `${m.audioCodec.toUpperCase()}${m.audioChannels ? ` ${m.audioChannels}ch` : ''}`,
                  (p.container ?? m.container)?.toUpperCase(),
                  m.bitrate && `${(m.bitrate / 1000).toFixed(1)} Mbps`,
                  fmtSize(p.size),
                  fmtDuration(p.duration ?? m.duration),
                ].filter(Boolean).map((f) => (
                  <span key={String(f)} className="tag">{f}</span>
                ))}
              </div>
              {p.streams.length > 0 && (
                <details>
                  <summary className="small">{p.streams.length} streams</summary>
                  <ul className="streams small">
                    {p.streams.map((s, k) => (
                      <li key={k}>
                        <span className="muted">{STREAM_KIND[s.streamType] ?? 'Stream'}:</span> {s.displayTitle ?? s.codec}
                        {s.selected && <span className="muted"> (default)</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </section>
      ))}

      <section>
        <h3>Details</h3>
        <dl className="facts">
          <dt>Plex ID</dt><dd>{full.ratingKey}</dd>
          {full.guid && (<><dt>Agent ID</dt><dd><code>{full.guid}</code></dd></>)}
          {full.guids.length > 0 && (<><dt>External IDs</dt><dd>{full.guids.join(', ')}</dd></>)}
          {full.library && (<><dt>Library</dt><dd>{full.library}</dd></>)}
          {full.addedAt && (<><dt>Added</dt><dd>{fmtDate(full.addedAt)}</dd></>)}
          {full.updatedAt && (<><dt>Updated</dt><dd>{fmtDate(full.updatedAt)}</dd></>)}
          {full.lastViewedAt && (<><dt>Last played</dt><dd>{fmtDate(full.lastViewedAt)}</dd></>)}
          {full.viewCount !== undefined && (<><dt>Plays</dt><dd>{full.viewCount}</dd></>)}
          {full.locked.length > 0 && (<><dt>Locked fields</dt><dd>{full.locked.join(', ')}</dd></>)}
        </dl>
      </section>
    </div>
  );
}
