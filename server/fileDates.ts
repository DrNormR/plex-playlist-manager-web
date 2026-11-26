import type { Request, Response, Router } from 'express';
import { getConfig, saveConfig, type AutoDateRule } from './config.js';
import { PlexError, Pms } from './plex.js';
import { fileStem, parseNameDate } from './filenames.js';

/**
 * "Dates from file names": set year and release date (and optionally the title) from names like
 *   "MLB - 2025-11-01 - Dodgers at Blue Jays (World Series Game 7).mp4"
 * Works on movie libraries (each movie) and TV libraries (each episode).
 */

export interface DateOptions {
  /** What to do with names that only have a year: set the release date to Jan 1, or leave it. */
  yearOnly: 'jan1' | 'keep';
  /** Also set the title to the file name (without extension). */
  setTitle: boolean;
}

export interface DatePlan {
  ratingKey: string;
  title: string;
  show?: string;
  file?: string;
  year?: number;
  date?: string;
  addedAt?: number;
  /** What the file name says. */
  parsed: { year: number; date?: string } | null;
  /** Only the fields that would change. */
  set: { year?: string; originallyAvailableAt?: string; title?: string };
}

const ITEM_TYPE: Record<string, number> = { movie: 1, show: 4 };

export function readOptions(src: any): DateOptions {
  return { yearOnly: src?.yearOnly === 'keep' ? 'keep' : 'jan1', setTitle: src?.setTitle === true || src?.setTitle === '1' };
}

export function planFor(m: any, opts: DateOptions): DatePlan {
  const file: string | undefined = m.Media?.[0]?.Part?.[0]?.file;
  const name = file ? fileStem(String(file)) : '';
  // No date in the file name? Try its folder, e.g. "WWE Attitude Era Vol. 2 (2014)\Attitude Era Vol. 2.mp4".
  const folder = file ? fileStem(String(file).replace(/[\\/][^\\/]*$/, ''), true) : '';
  const parsed = (name ? parseNameDate(name) : null) ?? (folder ? parseNameDate(folder) : null);
  const year = m.year ? Number(m.year) : undefined;
  const date: string | undefined = m.originallyAvailableAt || undefined;
  const set: DatePlan['set'] = {};
  if (parsed) {
    if (parsed.year !== year) set.year = String(parsed.year);
    if (parsed.date) {
      if (parsed.date !== date) set.originallyAvailableAt = parsed.date;
    } else if (opts.yearOnly === 'jan1' && (!date || Number(date.slice(0, 4)) !== parsed.year)) {
      // Keep an exact date that is already in the right year; otherwise use Jan 1 of that year.
      set.originallyAvailableAt = `${parsed.year}-01-01`;
    }
  }
  if (opts.setTitle && name && name !== m.title) set.title = name;
  return {
    ratingKey: String(m.ratingKey),
    title: String(m.title ?? ''),
    show: m.grandparentTitle,
    file,
    year,
    date,
    addedAt: m.addedAt,
    parsed,
    set,
  };
}

async function libraryInfo(p: Pms, sec: string) {
  const j = await p.get('/library/sections');
  const d = (j?.MediaContainer?.Directory ?? []).find((x: any) => String(x.key) === sec);
  if (!d) throw new PlexError(404, 'Library not found');
  const type = ITEM_TYPE[d.type];
  if (!type) throw new PlexError(400, 'Dates from file names works on movie and TV libraries only.');
  return { key: sec, title: String(d.title), type: String(d.type), itemType: type };
}

export async function applyPlan(p: Pms, sec: string, itemType: number, rk: string, set: DatePlan['set']) {
  const params: Record<string, string | number> = { type: itemType, id: rk };
  for (const [f, v] of Object.entries(set)) {
    if (v === undefined) continue;
    if (f === 'year' && !/^\d{4}$/.test(v)) throw new PlexError(400, 'Bad year');
    if (f === 'originallyAvailableAt' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new PlexError(400, 'Bad date');
    if (f === 'title' && !v.trim()) throw new PlexError(400, 'Empty title');
    params[`${f}.value`] = v;
    params[`${f}.locked`] = 1; // so a metadata refresh doesn't undo it
  }
  if (Object.keys(params).length > 2) await p.put(`/library/sections/${sec}/all`, params);
}

async function applyAll(p: Pms, sec: string, itemType: number, list: { ratingKey: string; set: DatePlan['set'] }[]) {
  let changed = 0;
  const failed: { ratingKey: string; error: string }[] = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const it = list[i++];
      try {
        await applyPlan(p, sec, itemType, it.ratingKey, it.set);
        changed++;
      } catch (e: any) {
        failed.push({ ratingKey: it.ratingKey, error: e?.message ?? String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  return { changed, failed };
}

const acctOf = (req: Request) => String((req.params as Record<string, string>).acct);
const ruleFor = (acct: string, sec: string) => (getConfig().autoDates ?? []).find((r) => r.acctId === acct && r.sec === sec);

export function registerDateRoutes(router: Router, pms: (res: Response) => Pms) {
  router.get('/libraries/:sec/date-scan', async (req, res) => {
    const p = pms(res);
    const sec = String(req.params.sec);
    const lib = await libraryInfo(p, sec);
    const opts = readOptions(req.query);
    const { items } = await p.getAll(`/library/sections/${sec}/all`, { type: lib.itemType, sort: 'addedAt:desc' });
    res.json({ library: lib, items: items.map((m) => planFor(m, opts)), auto: ruleFor(acctOf(req), sec) ?? null });
  });

  router.post('/libraries/:sec/date-apply', async (req, res) => {
    const p = pms(res);
    const sec = String(req.params.sec);
    const lib = await libraryInfo(p, sec);
    const raw: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
    const list = raw
      .filter((x) => /^\d+$/.test(String(x?.ratingKey ?? '')))
      .map((x) => ({
        ratingKey: String(x.ratingKey),
        set: {
          year: x.set?.year ? String(x.set.year) : undefined,
          originallyAvailableAt: x.set?.originallyAvailableAt ? String(x.set.originallyAvailableAt) : undefined,
          title: x.set?.title ? String(x.set.title) : undefined,
        },
      }));
    res.json(await applyAll(p, sec, lib.itemType, list));
  });

  /** Turn the automatic run on or off for this library (new titles only). */
  router.put('/libraries/:sec/date-auto', async (req, res) => {
    const p = pms(res);
    const acct = acctOf(req);
    const sec = String(req.params.sec);
    const lib = await libraryInfo(p, sec);
    const cfg = getConfig();
    const rules = (cfg.autoDates ??= []);
    const existing = ruleFor(acct, sec);
    if (!req.body?.enabled) {
      cfg.autoDates = rules.filter((r) => r !== existing);
      saveConfig();
      return void res.json(null);
    }
    const opts = readOptions(req.body);
    const rule: AutoDateRule = existing ?? {
      acctId: acct,
      sec,
      library: lib.title,
      // Titles added from now on. Existing ones are fixed from the preview.
      since: Math.floor(Date.now() / 1000),
      ...opts,
    };
    Object.assign(rule, opts, { library: lib.title });
    if (!existing) rules.push(rule);
    saveConfig();
    res.json(rule);
  });

  router.post('/libraries/:sec/date-auto/run', async (req, res) => {
    const rule = ruleFor(acctOf(req), String(req.params.sec));
    if (!rule) throw new PlexError(404, 'Automatic dates are off for this library.');
    await runRule(pms(res), rule);
    res.json(rule);
  });
}

async function runRule(p: Pms, rule: AutoDateRule) {
  try {
    const lib = await libraryInfo(p, rule.sec);
    const { items } = await p.getAll(`/library/sections/${rule.sec}/all`, { type: lib.itemType, 'addedAt>>': rule.since });
    const plans = items.map((m) => planFor(m, rule)).filter((x) => Object.keys(x.set).length);
    const r = await applyAll(p, rule.sec, lib.itemType, plans);
    const newest = Math.max(rule.since, ...items.map((m) => Number(m.addedAt) || 0));
    // Leave failed items for the next run.
    const oldestFailed = Math.min(
      ...r.failed.map((f) => Number(items.find((m) => String(m.ratingKey) === f.ratingKey)?.addedAt) || Infinity),
    );
    rule.since = Number.isFinite(oldestFailed) ? Math.min(newest, oldestFailed - 1) : newest;
    rule.library = lib.title;
    rule.lastRun = new Date().toISOString();
    rule.lastChanged = r.changed;
    rule.totalChanged = (rule.totalChanged ?? 0) + r.changed;
    rule.lastError = r.failed.length ? `${r.failed.length} failed: ${r.failed[0].error}` : undefined;
  } catch (e: any) {
    rule.lastRun = new Date().toISOString();
    rule.lastError = e?.message ?? String(e);
  }
  saveConfig();
}

let running = false;
/** Check libraries with automatic dates turned on, every `minutes`. */
export function startAutoDates(pmsFor: (acctId: string) => Pms | undefined, minutes = 30) {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const rule of [...(getConfig().autoDates ?? [])]) {
        const p = pmsFor(rule.acctId);
        if (!p) {
          rule.lastError = 'The account for this rule was removed.';
          continue;
        }
        await runRule(p, rule);
        if (rule.lastChanged) console.log(`Auto dates: ${rule.library}: ${rule.lastChanged} title(s) updated`);
      }
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, minutes * 60_000);
}
