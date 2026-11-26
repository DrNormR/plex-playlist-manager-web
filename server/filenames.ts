/** Reading titles, years and dates out of file and folder names. */

/** Last path component without its extension. Handles Windows and POSIX paths. */
export function fileStem(file: string, isFolder = false) {
  const base = file.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return isFolder ? base : base.replace(/\.[A-Za-z0-9]{2,5}$/, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number) {
  if (y < 1870 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface NameDate {
  year: number;
  /** YYYY-MM-DD, when the name has a full date. */
  date?: string;
}

/**
 * Find the date a sports file is about, e.g.
 *   "MLB - 2025-11-01 - Dodgers at Blue Jays (World Series Game 7)" → 2025-11-01
 *   "Super Bowl 56 - 2022 - Rams vs. Bengals"                        → year 2022
 * Full dates may use - . _ or space between parts, as YYYY-MM-DD or MM-DD-YYYY.
 */
export function parseNameDate(name: string): NameDate | null {
  const ymd = /(?<!\d)((?:18|19|20)\d{2})[-._ ](\d{1,2})[-._ ](\d{1,2})(?!\d)/.exec(name);
  if (ymd) {
    const [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    if (validDate(y, m, d)) return { year: y, date: `${y}-${pad(m)}-${pad(d)}` };
  }
  const mdy = /(?<!\d)(\d{1,2})[-._](\d{1,2})[-._]((?:18|19|20)\d{2})(?!\d)/.exec(name);
  if (mdy) {
    const [m, d, y] = [Number(mdy[1]), Number(mdy[2]), Number(mdy[3])];
    if (validDate(y, m, d)) return { year: y, date: `${y}-${pad(m)}-${pad(d)}` };
  }
  // A year on its own: prefer one set off as " - 2022 - ", "(2022)" or "[2022]".
  const years = [...name.matchAll(/(?<!\d)((?:18|19|20)\d{2})(?!\d|p\b)/gi)];
  if (!years.length) return null;
  const setOff = years.find((m) => {
    const before = name.slice(0, m.index).trimEnd();
    const after = name.slice(m.index! + 4).trimStart();
    return /[-([]$/.test(before) || /^[-)\]]/.test(after) || m.index === 0;
  });
  return { year: Number((setOff ?? years[0])[1]) };
}

const JUNK =
  /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|bdrip|brrip|bdremux|remux|web-?dl|webrip|web|hdtv|dvdrip|dvd|hdrip|x264|x265|h\.?264|h\.?265|hevc|avc|aac\d?|ac3|dts(-hd)?|truehd|atmos|10bit|proper|repack|extended|unrated|imax|criterion)\b/i;

/**
 * Guess a title and year from a movie file or show folder name, the way Plex does:
 *   "Blade Runner 2049 (2017) {imdb-tt1856101}.mkv" → Blade Runner 2049, 2017
 *   "The.Crucible.1996.1080p.BluRay.x264.mkv"       → The Crucible, 1996
 */
export function guessTitleYear(name: string): { title: string; year?: number } {
  let s = name.replace(/\{[^}]*\}/g, ' ').replace(/\[((?:18|19|20)\d{2})\]/g, '($1)').replace(/\[[^\]]*\]/g, ' ');
  if (!/\s/.test(s.trim()) && /[._]/.test(s)) s = s.replace(/[._]/g, ' ');
  else s = s.replace(/_/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Prefer a year in parentheses; otherwise the last plausible year that isn't the whole title.
  let cut = -1;
  let year: number | undefined;
  const paren = /\(((?:18|19|20)\d{2})\)/.exec(s);
  if (paren && paren.index > 0) {
    cut = paren.index;
    year = Number(paren[1]);
  } else {
    const all = [...s.matchAll(/(?<!\d)((?:18|19|20)\d{2})(?!\d|p\b)/gi)].filter((m) => m.index! > 0);
    const last = all[all.length - 1];
    if (last) {
      cut = last.index!;
      year = Number(last[1]);
    }
  }
  let title = cut > 0 ? s.slice(0, cut) : s;
  const junk = JUNK.exec(title);
  if (junk && junk.index > 0) title = title.slice(0, junk.index);
  title = title.replace(/[\s\-–.,(:]+$/, '').trim();
  // "Island, The" → "The Island"
  const art = /^(.*),\s*(The|A|An)$/i.exec(title);
  if (art) title = `${art[2]} ${art[1]}`;
  return { title: title || s, year };
}
