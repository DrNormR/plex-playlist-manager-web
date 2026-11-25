import { useEffect, useRef, useState } from 'react';
import { api, errMsg, thumbUrl } from '../api';
import { useApp } from '../ctx';
import type { ArtKind, ArtOption } from '../types';
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
  const fromUrl = async () => {
    const ok = await busy('Sending to Plex…', async () => (await api.artFromUrl(acctId, ratingKey, kind, url.trim()), true));
    if (ok) await done(`${kind === 'poster' ? posterLabel : 'Background'} set from URL`);
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
