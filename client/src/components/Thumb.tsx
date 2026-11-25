import { useState } from 'react';
import { thumbUrl } from '../api';

export function Thumb({ acct, path, w = 40, h = 60, square }: { acct: string; path?: string; w?: number; h?: number; square?: boolean }) {
  const [failed, setFailed] = useState(false);
  const height = square ? w : h;
  const src = thumbUrl(acct, path, w * 2, height * 2);
  if (!src || failed) return <div className="thumb empty" style={{ width: w, height }} />;
  return <img className="thumb" src={src} width={w} height={height} loading="lazy" alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
