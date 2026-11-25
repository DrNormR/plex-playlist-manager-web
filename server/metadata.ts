import type { Response, Router } from 'express';
import { PlexError, Pms, TYPE_NUM, normItem } from './plex.js';

/** Plain-text fields Plex lets you edit (and lock) per item. */
export const TEXT_FIELDS = [
  'title', 'titleSort', 'originalTitle', 'editionTitle', 'originallyAvailableAt', 'year',
  'contentRating', 'studio', 'tagline', 'summary',
] as const;

/** Tag fields: request name → key in Plex's JSON. */
export const TAG_FIELDS: Record<string, string> = {
  genre: 'Genre', label: 'Label', collection: 'Collection', director: 'Director', writer: 'Writer',
  producer: 'Producer', country: 'Country', style: 'Style', mood: 'Mood',
};

const rkParam = (v: unknown) => {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new PlexError(400, 'Bad item id');
  return s;
};

async function rawMeta(p: Pms, rk: string) {
  const j = await p.get(`/library/metadata/${rk}`, { checkFiles: 1, includeGuids: 1 });
  const m = j?.MediaContainer?.Metadata?.[0];
  if (!m) throw new PlexError(404, 'Title not found');
  return { m, sectionId: String(m.librarySectionID ?? j?.MediaContainer?.librarySectionID ?? '') };
}

function fullDetails(m: any, sectionId: string) {
  const fields: Record<string, string> = {};
  for (const f of TEXT_FIELDS) if (m[f] !== undefined && m[f] !== null) fields[f] = String(m[f]);
  const tags: Record<string, string[]> = {};
  for (const [k, json] of Object.entries(TAG_FIELDS)) tags[k] = ((m[json] ?? []) as any[]).map((t) => String(t.tag));
  const locked = ((m.Field ?? []) as any[]).filter((f) => f.locked).map((f) => String(f.name));
  return {
    ...normItem(m),
    librarySectionID: sectionId,
    fields,
    tags,
    locked,
    guid: m.guid as string | undefined,
    guids: ((m.Guid ?? []) as any[]).map((g) => String(g.id)),
    addedAt: m.addedAt as number | undefined,
    updatedAt: m.updatedAt as number | undefined,
    lastViewedAt: m.lastViewedAt as number | undefined,
    viewCount: m.viewCount as number | undefined,
    locations: ((m.Location ?? []) as any[]).map((l) => String(l.path)),
    media: ((m.Media ?? []) as any[]).map((md) => ({
      id: String(md.id),
      videoResolution: md.videoResolution,
      width: md.width,
      height: md.height,
      videoCodec: md.videoCodec,
      videoFrameRate: md.videoFrameRate,
      audioCodec: md.audioCodec,
      audioChannels: md.audioChannels,
      container: md.container,
      bitrate: md.bitrate,
      duration: md.duration,
      editionTitle: md.editionTitle,
      parts: ((md.Part ?? []) as any[]).map((pt) => ({
        file: pt.file as string | undefined,
        size: pt.size as number | undefined,
        container: pt.container,
        duration: pt.duration,
        exists: pt.exists,
        accessible: pt.accessible,
        streams: ((pt.Stream ?? []) as any[]).map((s) => ({
          streamType: s.streamType as number,
          codec: s.codec,
          displayTitle: s.extendedDisplayTitle ?? s.displayTitle,
          language: s.language,
          selected: !!s.selected,
        })),
      })),
    })),
  };
}

/**
 * Build the query for PUT /library/sections/{id}/all. Only changed fields/tags are sent.
 * Tags use Plex's syntax: genre[0].tag.tag=Add and genre[].tag.tag-=Remove1,Remove2.
 */
export function buildEditParams(
  current: { fields: Record<string, string>; tags: Record<string, string[]>; locked: string[] },
  body: { fields?: Record<string, unknown>; locked?: Record<string, unknown>; tags?: Record<string, unknown> },
) {
  const params: Record<string, string> = {};
  const lockedNow = new Set(current.locked);

  for (const f of TEXT_FIELDS) {
    const hasValue = body.fields && Object.prototype.hasOwnProperty.call(body.fields, f);
    const wantLock = body.locked?.[f];
    if (hasValue) {
      const v = String(body.fields![f] ?? '').trim();
      if (f === 'originallyAvailableAt' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new PlexError(400, 'Release date must be YYYY-MM-DD');
      if (f === 'year' && v && !/^\d{4}$/.test(v)) throw new PlexError(400, 'Year must be four digits');
      if (v !== (current.fields[f] ?? '')) {
        params[`${f}.value`] = v;
        params[`${f}.locked`] = wantLock === false ? '0' : '1'; // editing locks unless told otherwise
        continue;
      }
    }
    if (typeof wantLock === 'boolean' && wantLock !== lockedNow.has(f)) params[`${f}.locked`] = wantLock ? '1' : '0';
  }

  for (const t of Object.keys(TAG_FIELDS)) {
    const raw = body.tags?.[t];
    const wantLock = body.locked?.[t];
    if (Array.isArray(raw)) {
      const want = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
      const have = current.tags[t] ?? [];
      const lower = (a: string[]) => new Set(a.map((x) => x.toLowerCase()));
      const haveL = lower(have);
      const wantL = lower(want);
      const add = want.filter((x) => !haveL.has(x.toLowerCase()));
      const remove = have.filter((x) => !wantL.has(x.toLowerCase()));
      add.forEach((v, i) => (params[`${t}[${i}].tag.tag`] = v));
      if (remove.length) params[`${t}[].tag.tag-`] = remove.map((x) => encodeURIComponent(x)).join(',');
      if (add.length || remove.length) {
        params[`${t}.locked`] = wantLock === false ? '0' : '1';
        continue;
      }
    }
    if (typeof wantLock === 'boolean' && wantLock !== lockedNow.has(t)) params[`${t}.locked`] = wantLock ? '1' : '0';
  }
  return params;
}

export function registerMetadataRoutes(router: Router, pms: (res: Response) => Pms) {
  router.get('/items/:rk/full', async (req, res) => {
    const { m, sectionId } = await rawMeta(pms(res), rkParam(req.params.rk));
    res.json(fullDetails(m, sectionId));
  });

  router.put('/items/:rk/edit', async (req, res) => {
    const p = pms(res);
    const rk = rkParam(req.params.rk);
    const { m, sectionId } = await rawMeta(p, rk);
    const type = TYPE_NUM[m.type];
    if (!type || !sectionId) throw new PlexError(400, `Editing ${m.type ?? 'this item'} isn't supported`);
    const current = fullDetails(m, sectionId);
    const params = buildEditParams(current, req.body ?? {});
    if (Object.keys(params).length) {
      await p.put(`/library/sections/${sectionId}/all`, { type, id: rk, ...params });
    }
    const after = await rawMeta(p, rk);
    res.json({ changed: Object.keys(params).length, item: fullDetails(after.m, after.sectionId) });
  });

  router.get('/libraries/:sec/tags/:field', async (req, res) => {
    const field = String(req.params.field);
    if (!TAG_FIELDS[field]) throw new PlexError(400, 'Unknown tag field');
    const p = pms(res);
    const type = req.query.type && TYPE_NUM[String(req.query.type)] ? TYPE_NUM[String(req.query.type)] : undefined;
    try {
      const j = await p.get(`/library/sections/${req.params.sec}/${field}`, { type });
      res.json(((j?.MediaContainer?.Directory ?? []) as any[]).map((d) => String(d.title)));
    } catch (e) {
      if (e instanceof PlexError && e.status === 404) return void res.json([]);
      throw e;
    }
  });

  router.get('/items/:rk/matches', async (req, res) => {
    const rk = rkParam(req.params.rk);
    const title = String(req.query.title ?? '').trim();
    const year = String(req.query.year ?? '').trim();
    const j = await pms(res).get(`/library/metadata/${rk}/matches`, {
      manual: 1,
      title: title || undefined,
      year: /^\d{4}$/.test(year) ? year : undefined,
    });
    res.json(
      ((j?.MediaContainer?.SearchResult ?? []) as any[]).map((r) => ({
        guid: String(r.guid),
        name: String(r.name ?? r.title ?? ''),
        year: r.year as number | undefined,
        score: r.score as number | undefined,
        thumb: r.thumb as string | undefined,
        summary: r.summary as string | undefined,
        matched: !!r.matched,
      })),
    );
  });

  router.post('/items/:rk/match', async (req, res) => {
    const p = pms(res);
    const rk = rkParam(req.params.rk);
    const guid = String(req.body?.guid ?? '');
    if (!guid) throw new PlexError(400, 'Pick a match');
    const { m: before, sectionId } = await rawMeta(p, rk);
    await p.put(`/library/metadata/${rk}/match`, {
      guid,
      name: req.body?.name ? String(req.body.name) : undefined,
      year: req.body?.year ? String(req.body.year) : undefined,
    });

    // If another item in the library already had this match, Plex merges the two
    // into that item and this ratingKey disappears. Find where it went.
    try {
      await p.get(`/library/metadata/${rk}`);
      return void res.json({ ok: true, ratingKey: rk, merged: false });
    } catch (e) {
      if (!(e instanceof PlexError) || e.status !== 404) throw e;
    }
    const type = TYPE_NUM[before.type];
    let found: any;
    for (let attempt = 0; attempt < 5 && !found; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000));
      const j = await p.get(`/library/sections/${sectionId}/all`, { type, guid });
      found = j?.MediaContainer?.Metadata?.[0];
    }
    if (!found) {
      throw new PlexError(404, 'Plex applied the match but the item moved and could not be found. Reload the library to see it.');
    }
    res.json({ ok: true, ratingKey: String(found.ratingKey), merged: true, title: found.title, year: found.year });
  });

  router.post('/items/:rk/unmatch', async (req, res) => {
    await pms(res).put(`/library/metadata/${rkParam(req.params.rk)}/unmatch`);
    res.json({ ok: true });
  });

  router.post('/items/:rk/refresh', async (req, res) => {
    await pms(res).put(`/library/metadata/${rkParam(req.params.rk)}/refresh`, { force: 1 });
    res.json({ ok: true });
  });
}
