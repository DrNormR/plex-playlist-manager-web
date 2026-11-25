import { useEffect, useRef, useState } from 'react';
import { api, errMsg, thumbUrl } from '../api';
import { useApp } from '../ctx';
import type { ArtKind, ArtOption, WebImage } from '../types';
import { Modal } from './Modal';

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Change a poster/thumbnail or background art: upload a file, paste a URL,
 * or pick one of the alternatives Plex already knows about.
 */
export function ArtworkDialog({ acctId, ratingKey, title, itemType, onClose, onChanged }: {
  acctId: string;
  ratingKey: string;
  title: string;
  itemType: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { notify, busy } = useApp();
  const [kind, setKind] = useState<ArtKind>('poster');
  const [options, setOptions] = useState<ArtOption[] | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const posterLabel = ['episode', 'track'].includes(itemType) ? 'Thumbnail' : 'Poster';
  const wide = kind === 'art' || itemType === 'episode';
  const square = kind === 'poster' && ['album', 'artist', 'track', 'playlist'].includes(itemType);

  const load = async () => {
    setOptions(null);
    setError('');
    try {
      setOptions(await api.artOptions(acctId, ratingKey, kind));
    } catch (e) {
      setError(errMsg(e));
      setOptions([]);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ratingKey, acctId]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!TYPES.includes(f.type)) return notify('Choose a JPEG, PNG or WebP image', 'error');
    if (f.size > MAX_BYTES) return notify('That image is over 20 MB', 'error');
    setFile(f);
    setUrl('');
  };

  const done = async (msg: string) => {
    notify(msg, 'ok');
    setFile(null);
    setUrl('');
    await load();
    onChanged?.();
  };

  const upload = async () => {
    if (!file) return;
    const ok = await busy('Uploading to Plex…', async () => (await api.uploadArt(acctId, ratingKey, kind, file), true));
    if (ok) await done(`${kind === 'poster' ? posterLabel : 'Background'} uploaded`);
  };
  const fromUrl = async (u = url.trim()) => {
    const ok = await busy('Sending to Plex…', async () => (await api.artFromUrl(acctId, ratingKey, kind, u), true));
    if (ok) await done(`${kind === 'poster' ? posterLabel : 'Background'} set from URL`);
    return !!ok;
  };
  const select = async (o: ArtOption) => {
    if (o.selected) return;
    const ok = await busy('Updating…', async () => (await api.selectArt(acctId, ratingKey, kind, o.key), true));
    if (ok) await done('Artwork changed');
  };

  return (
    <Modal wide title={`Artwork: ${title}`} onClose={onClose} footer={<button onClick={onClose}>Done</button>}>
      <div className="seg">
        <button className={kind === 'poster' ? 'on' : ''} onClick={() => setKind('poster')}>{posterLabel}</button>
        <button className={kind === 'art' ? 'on' : ''} onClick={() => setKind('art')}>Background</button>
      </div>

      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files[0]);
        }}
        onClick={() => fileInput.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="" className={`art-preview ${wide ? 'wide' : square ? 'square' : ''}`} />
        ) : (
          <span>Drop an image here or <u>choose a file</u> (JPEG, PNG or WebP, up to 20 MB)</span>
        )}
        <input ref={fileInput} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pickFile(e.target.files?.[0] ?? undefined)} />
      </div>
      {file && (
        <div className="inline-form">
          <span className="grow small ellipsis">{file.name} · {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span>
          <button onClick={() => setFile(null)}>Clear</button>
          <button className="primary" onClick={upload}>Upload {kind === 'poster' ? posterLabel.toLowerCase() : 'background'}</button>
        </div>
      )}

      <form className="inline-form" onSubmit={(e) => (e.preventDefault(), url.trim() && fromUrl())}>
        <input className="grow" placeholder="…or paste an image URL (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="primary" disabled={!/^https?:\/\/\S+$/i.test(url.trim())}>Use URL</button>
      </form>

      <WebImageSearch
        title={title}
        wide={wide}
        useLabel={`Use as ${kind === 'poster' ? posterLabel.toLowerCase() : 'background'}`}
        onUse={(u) => fromUrl(u)}
      />

      <h3>{options?.length ? 'Or pick one Plex already has' : 'Available artwork'}</h3>
      {error && <div className="banner error">{/40[13]/.test(error) ? `This account can't change this artwork. Use the server admin account. (${error})` : error}</div>}
      {!options && !error && <div className="muted">Loading…</div>}
      {options && !options.length && !error && <div className="muted small">Plex has no alternatives for this yet.</div>}
      <div className={`art-grid ${wide ? 'wide' : square ? 'square' : ''}`}>
        {options?.map((o) => (
          <button key={o.key} className={`art-option ${o.selected ? 'selected' : ''}`} onClick={() => select(o)} title={o.provider ?? ''}>
            <img src={thumbUrl(acctId, o.thumb, wide ? 320 : 200, wide ? 180 : square ? 200 : 300)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            {o.selected && <span className="art-badge">Current</span>}
            {o.provider && <span className="art-provider">{o.provider.replace(/^com\.plexapp\.agents\./, '')}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Whether a SerpApi key is set, checked once per page load.
let searchConfigured: Promise<boolean> | null = null;

/** Google Images search (via SerpApi) inside the artwork dialog. */
function WebImageSearch({ title, wide, useLabel, onUse }: {
  title: string;
  wide: boolean;
  useLabel: string;
  onUse: (url: string) => Promise<boolean>;
}) {
  const [q, setQ] = useState(title);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [results, setResults] = useState<WebImage[] | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<WebImage | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    searchConfigured ??= api.imageSearchStatus().then((s) => s.configured, () => false);
    searchConfigured.then(setConfigured);
  }, []);

  const run = async (nextPage = 0) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.imageSearch(q.trim(), nextPage);
      setResults((cur) => (nextPage === 0 ? r.results : [...(cur ?? []), ...r.results.filter((x) => !cur?.some((c) => c.original === x.original))]));
      setPage(nextPage);
      if (nextPage === 0) setPicked(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  // Show images with the right shape first (tall for posters, wide for backgrounds), keeping Google's order otherwise.
  const fits = (i: WebImage) => {
    if (!i.width || !i.height) return 1;
    const r = i.width / i.height;
    return wide ? (r >= 1.3 ? 0 : 2) : r <= 0.85 ? 0 : 2;
  };
  const sorted = results ? [...results].sort((a, b) => fits(a) - fits(b)) : null;
  const googleUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q.trim() || title)}`;

  return (
    <section className="web-search">
      <h3>Search the web</h3>
      <form className="inline-form" onSubmit={(e) => (e.preventDefault(), run(0))}>
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What to search for" />
        <button className="primary" disabled={!configured || loading || !q.trim()}>{loading && page === 0 ? 'Searching…' : 'Search images'}</button>
        <a className="small nowrap" href={googleUrl} target="_blank" rel="noreferrer">Open in Google Images ↗</a>
      </form>
      {configured === false && (
        <div className="muted small">
          To search right here, add a SerpApi key on the Accounts page. Meanwhile, “Open in Google Images” works: right-click an image there, copy its address, and paste it in the URL box above.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {sorted && !sorted.length && !error && <div className="muted small">No images found. Try fewer words, e.g. just the teams and the date.</div>}

      {picked && (
        <div className="web-picked">
          <img
            src={previewFailed ? picked.thumbnail : picked.original}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setPreviewFailed(true)}
          />
          <div className="grow">
            <div className="small"><strong>{picked.title ?? 'Image'}</strong></div>
            <div className="muted small">
              {picked.width && picked.height ? `${picked.width}×${picked.height}` : 'Size unknown'}
              {picked.source ? ` · ${picked.source}` : ''}
              {picked.link && (
                <>
                  {' · '}
                  <a href={picked.link} target="_blank" rel="noreferrer">page ↗</a>
                </>
              )}
            </div>
            {previewFailed && <div className="muted small">That site blocks previews, but Plex can usually still download it.</div>}
            <div className="inline-form">
              <button
                className="primary"
                onClick={async () => {
                  if (await onUse(picked.original)) setPicked(null);
                }}
              >
                {useLabel}
              </button>
              <button onClick={() => setPicked(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <>
          <div className={`web-grid ${wide ? 'wide' : ''}`}>
            {sorted.map((i) => (
              <button
                key={i.original}
                className={`web-thumb ${picked?.original === i.original ? 'on' : ''} ${fits(i) === 2 ? 'off-shape' : ''}`}
                onClick={() => (setPicked(i), setPreviewFailed(false))}
                title={`${i.title ?? ''}${i.source ? ` · ${i.source}` : ''}`}
              >
                <img src={i.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {i.width && i.height && <span className="dims">{i.width}×{i.height}</span>}
              </button>
            ))}
          </div>
          <div className="inline-form">
            <button onClick={() => run(page + 1)} disabled={loading}>{loading ? 'Loading…' : 'More results'}</button>
            <span className="muted small">Click an image to preview it. Shapes that don't fit are dimmed.</span>
          </div>
        </>
      )}
    </section>
  );
}
