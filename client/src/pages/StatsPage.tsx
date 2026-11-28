import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Item, LibraryCompletion, StatsData } from '../types';
import { Thumb } from '../components/Thumb';
import { TitlePanel } from '../components/TitlePanel';
import { timeAgo } from './RecentPage';

type Period = '7' | '30' | '90' | '365' | 'all';
type Metric = 'plays' | 'hours';
type Kind = 'all' | 'movie' | 'show' | 'other';

const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: '365', label: '1 year' },
  { id: 'all', label: 'All time' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const hours = (min: number) => min / 60;
const fmtHours = (min: number) => {
  const h = min / 60;
  return h >= 100 ? `${Math.round(h).toLocaleString()} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(min)} min`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface Agg {
  plays: number;
  min: number;
}
const bump = <K,>(m: Map<K, Agg>, k: K, min: number) => {
  const a = m.get(k) ?? { plays: 0, min: 0 };
  a.plays++;
  a.min += min;
  m.set(k, a);
};

/** Vertical single-series bar chart with a hover/focus readout. */
function Columns({ data, metric, height = 140, labelEvery = 1 }: { data: { label: string; tip: string; v: Agg }[]; metric: Metric; height?: number; labelEvery?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (a: Agg) => (metric === 'plays' ? a.plays : hours(a.min));
  const max = Math.max(1e-9, ...data.map((d) => val(d.v)));
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="cols-wrap">
      <div className="readout small">
        {h ? (
          <>
            <strong>{metric === 'plays' ? h.v.plays.toLocaleString() + ' plays' : fmtHours(h.v.min)}</strong>
            <span className="muted"> · {h.tip}{metric === 'plays' ? ` · ${fmtHours(h.v.min)}` : ` · ${h.v.plays} plays`}</span>
          </>
        ) : (
          <span className="muted">Hover a bar for its value</span>
        )}
      </div>
      <div className="cols" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div
            key={i}
            className={`col ${hover === i ? 'on' : ''}`}
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${d.tip}: ${d.v.plays} plays, ${fmtHours(d.v.min)}`}
          >
            <div className="bar" style={{ height: `${(val(d.v) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="col-labels">
        {data.map((d, i) => (
          <div key={i} className="muted">{i % labelEvery === 0 ? d.label : ''}</div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars with the values written out (no hover needed). */
function Bars({ rows, metric }: { rows: { label: string; v: Agg }[]; metric: Metric }) {
  const val = (a: Agg) => (metric === 'plays' ? a.plays : a.min);
  const max = Math.max(1e-9, ...rows.map((r) => val(r.v)));
  if (!rows.length) return <div className="muted small">No plays.</div>;
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar" title={`${r.label}: ${r.v.plays} plays, ${fmtHours(r.v.min)}`}>
          <div className="ellipsis">{r.label}</div>
          <div className="track"><div className="bar" style={{ width: `${(val(r.v) / max) * 100}%` }} /></div>
          <div className="num">{metric === 'plays' ? r.v.plays.toLocaleString() : fmtHours(r.v.min)}</div>
        </div>
      ))}
    </div>
  );
}

export function StatsPage() {
  const { acct } = useApp();
  const acctId = acct!.id;
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [completion, setCompletion] = useState<LibraryCompletion[] | null>(null);
  const [period, setPeriod] = useState<Period>(() => (localStorage.getItem('ppm.stats.period') as Period) || '365');
  const [who, setWho] = useState<string>(''); // '' = everyone, else account index
  const [lib, setLib] = useState<string>(''); // '' = all, else library index
  const [metric, setMetric] = useState<Metric>('plays');
  const [kind, setKind] = useState<Kind>('all');
  const [topBy, setTopBy] = useState<Metric>('plays');
  const [focus, setFocus] = useState<Item | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      setData(await api.stats(acctId, refresh));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    api.libraryCompletion(acctId).then(setCompletion, () => setCompletion([]));
  }, [acctId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default the profile filter to the selected account, once the data names it.
  useEffect(() => {
    if (!data) return;
    const i = data.accounts.findIndex((a) => a.name.toLowerCase() === acct!.name.toLowerCase());
    setWho(i >= 0 ? String(i) : '');
  }, [data, acct]);

  const s = useMemo(() => {
    if (!data) return null;
    const now = Date.now() / 1000;
    const from = period === 'all' ? 0 : now - Number(period) * 86400;
    const plays = data.plays.filter(
      (p) => p[0] >= from && (who === '' || p[2] === Number(who)) && (lib === '' || p[4] === Number(lib)),
    );

    const titles = new Map<number, Agg & { last: number; viewers: Set<number> }>();
    const byDay = new Map<string, Agg>();
    const byWeekday = new Map<number, Agg>();
    const byHour = new Map<number, Agg>();
    const byLib = new Map<number, Agg>();
    const byAcct = new Map<number, Agg>();
    const byDev = new Map<number, Agg>();
    let min = 0;
    let estimated = 0;
    for (const p of plays) {
      const [t, ti, ai, m, li, di, est] = p;
      min += m;
      estimated += est;
      const d = new Date(t * 1000);
      const ta = titles.get(ti) ?? { plays: 0, min: 0, last: 0, viewers: new Set<number>() };
      ta.plays++;
      ta.min += m;
      ta.last = Math.max(ta.last, t);
      ta.viewers.add(ai);
      titles.set(ti, ta);
      bump(byDay, dayKey(d), m);
      bump(byWeekday, d.getDay(), m);
      bump(byHour, d.getHours(), m);
      bump(byLib, li, m);
      bump(byAcct, ai, m);
      if (di >= 0) bump(byDev, di, m);
    }

    // Timeline buckets: days for short ranges, weeks for a year, months for all time.
    const firstT = plays.length ? Math.min(...plays.map((p) => p[0])) : now;
    const start = period === 'all' ? firstT : from;
    const timeline: { label: string; tip: string; v: Agg }[] = [];
    const span = (now - start) / 86400;
    if (span <= 92) {
      for (let d = new Date(start * 1000); d.getTime() <= now * 1000; d.setDate(d.getDate() + 1)) {
        const k = dayKey(d);
        timeline.push({ label: d.getDate() === 1 || timeline.length === 0 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : String(d.getDate()), tip: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), v: byDay.get(k) ?? { plays: 0, min: 0 } });
      }
    } else if (span <= 400) {
      const wk = new Map<string, Agg>();
      for (const [k, v] of byDay) {
        const d = new Date(k + 'T12:00');
        d.setDate(d.getDate() - d.getDay());
        const a = wk.get(dayKey(d)) ?? { plays: 0, min: 0 };
        a.plays += v.plays;
        a.min += v.min;
        wk.set(dayKey(d), a);
      }
      const d = new Date(start * 1000);
      d.setDate(d.getDate() - d.getDay());
      for (; d.getTime() <= now * 1000; d.setDate(d.getDate() + 7)) {
        timeline.push({ label: d.getDate() <= 7 ? d.toLocaleDateString(undefined, { month: 'short' }) : '', tip: `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`, v: wk.get(dayKey(d)) ?? { plays: 0, min: 0 } });
      }
    } else {
      const mo = new Map<string, Agg>();
      for (const [k, v] of byDay) {
        const key = k.slice(0, 7);
        const a = mo.get(key) ?? { plays: 0, min: 0 };
        a.plays += v.plays;
        a.min += v.min;
        mo.set(key, a);
      }
      const d = new Date(start * 1000);
      d.setDate(1);
      for (; d.getTime() <= now * 1000; d.setMonth(d.getMonth() + 1)) {
        const key = dayKey(d).slice(0, 7);
        timeline.push({ label: d.getMonth() === 0 ? String(d.getFullYear()) : '', tip: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), v: mo.get(key) ?? { plays: 0, min: 0 } });
      }
    }

    // Streaks and busiest day.
    const days = [...byDay.keys()].sort();
    let best = 0;
    let run = 0;
    let prev = '';
    for (const k of days) {
      const p = new Date(prev + 'T12:00');
      p.setDate(p.getDate() + 1);
      run = prev && dayKey(p) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    const busiest = [...byDay.entries()].sort((a, b) => b[1].plays - a[1].plays)[0];

    const top = [...titles.entries()]
      .map(([ti, a]) => ({ t: data.titles[ti], ...a }))
      .filter((x) => kind === 'all' || (kind === 'other' ? !['movie', 'show'].includes(x.t.type) : x.t.type === kind));

    const named = <K,>(m: Map<K, Agg>, name: (k: K) => string) =>
      [...m.entries()].map(([k, v]) => ({ label: name(k), v })).sort((a, b) => b.v.plays - a.v.plays);

    return {
      plays: plays.length,
      min,
      estimated,
      titles: titles.size,
      activeDays: byDay.size,
      best,
      busiest,
      timeline,
      weekday: DAYS.map((d, i) => ({ label: d, tip: d, v: byWeekday.get(i) ?? { plays: 0, min: 0 } })),
      hour: Array.from({ length: 24 }, (_, h) => ({
        label: h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : '',
        tip: new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }),
        v: byHour.get(h) ?? { plays: 0, min: 0 },
      })),
      libs: named(byLib, (k) => data.libraries[k]?.title ?? 'Removed library'),
      accts: named(byAcct, (k) => data.accounts[k]?.name ?? '?'),
      devs: named(byDev, (k) => data.devices[k]?.name ?? '?').slice(0, 10),
      top,
    };
  }, [data, period, who, lib, kind]);

  const topRows = useMemo(() => {
    if (!s) return [];
    return [...s.top].sort((a, b) => (topBy === 'plays' ? b.plays - a.plays || b.min - a.min : b.min - a.min)).slice(0, 30);
  }, [s, topBy]);
  const topMax = Math.max(1, ...topRows.map((r) => (topBy === 'plays' ? r.plays : r.min)));

  const changePeriod = (p: Period) => {
    setPeriod(p);
    localStorage.setItem('ppm.stats.period', p);
  };

  return (
    <div className="split">
      <main className="main stats">
        <div className="stats-filters">
          <div className="seg">
            {PERIODS.map((p) => (
              <button key={p.id} className={period === p.id ? 'on' : ''} onClick={() => changePeriod(p.id)}>{p.label}</button>
            ))}
          </div>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Profile">
            <option value="">All profiles</option>
            {data?.accounts.map((a, i) => (
              <option key={a.id} value={i}>{a.name}</option>
            ))}
          </select>
          <select value={lib} onChange={(e) => setLib(e.target.value)} aria-label="Library">
            <option value="">All libraries</option>
            {data?.libraries.map((l, i) => (
              <option key={l.key} value={i}>{l.title}</option>
            ))}
          </select>
          <div className="seg">
            <button className={metric === 'plays' ? 'on' : ''} onClick={() => setMetric('plays')}>Plays</button>
            <button className={metric === 'hours' ? 'on' : ''} onClick={() => setMetric('hours')}>Hours</button>
          </div>
          <span className="spacer" />
          {data && <span className="muted small">Updated {timeAgo(Math.floor(data.generatedAt / 1000))}</span>}
          <button onClick={() => load(true)} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
        </div>

        {error && <div className="banner error">{error}</div>}
        {!data && !error && <div className="muted pad">Reading play history… (the first time takes a little while: it looks up how long each title is)</div>}

        {s && (
          <div className={`stats-body ${loading ? 'dim' : ''}`}>
            <div className="tiles">
              <div className="tile"><div className="big">{s.plays.toLocaleString()}</div><div className="muted small">plays</div></div>
              <div className="tile"><div className="big">{fmtHours(s.min)}</div><div className="muted small">watch time</div></div>
              <div className="tile"><div className="big">{s.titles.toLocaleString()}</div><div className="muted small">different titles</div></div>
              <div className="tile"><div className="big">{s.activeDays.toLocaleString()}</div><div className="muted small">days with plays</div></div>
              <div className="tile"><div className="big">{s.activeDays ? fmtHours(s.min / s.activeDays) : '—'}</div><div className="muted small">per active day</div></div>
              <div className="tile"><div className="big">{s.best ? `${s.best} d` : '—'}</div><div className="muted small">longest daily streak</div></div>
              <div className="tile">
                <div className="big">{s.busiest ? s.busiest[1].plays : '—'}</div>
                <div className="muted small">{s.busiest ? `plays on ${new Date(s.busiest[0] + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} (busiest day)` : 'busiest day'}</div>
              </div>
            </div>

            <section className="card">
              <h3>{metric === 'plays' ? 'Plays' : 'Hours watched'} over time</h3>
              <Columns data={s.timeline} metric={metric} />
            </section>

            <section className="card">
              <div className="card-head">
                <h3>Most watched</h3>
                <div className="seg small">
                  {(['all', 'movie', 'show', 'other'] as Kind[]).map((k) => (
                    <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{{ all: 'All', movie: 'Movies', show: 'Shows', other: 'Other' }[k]}</button>
                  ))}
                </div>
                <div className="seg small">
                  <button className={topBy === 'plays' ? 'on' : ''} onClick={() => setTopBy('plays')}>By plays</button>
                  <button className={topBy === 'hours' ? 'on' : ''} onClick={() => setTopBy('hours')}>By time</button>
                </div>
              </div>
              {!topRows.length ? (
                <div className="muted small">No plays in this range.</div>
              ) : (
                <table className="top-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th colSpan={2}>Title</th>
                      <th className="num">Plays</th>
                      <th className="num">Time</th>
                      <th>Last played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((r, n) => (
                      <tr
                        key={r.t.key}
                        className={`${focus?.ratingKey === r.t.key ? 'focused' : ''} ${r.t.key.startsWith('name:') ? 'gone' : ''}`}
                        onClick={() => !r.t.key.startsWith('name:') && setFocus({ ratingKey: r.t.key, type: r.t.type, title: r.t.title, displayTitle: r.t.title, thumb: r.t.thumb })}
                      >
                        <td className="muted">{n + 1}</td>
                        <td><Thumb acct={acctId} path={r.t.thumb} w={30} h={45} square={r.t.type === 'artist'} /></td>
                        <td className="grow">
                          <div className="ellipsis">{r.t.title}</div>
                          <div className="muted small">
                            {r.t.key.startsWith('name:') ? 'removed from the library' : (data!.libraries[r.t.lib]?.title ?? '')}
                            {who === '' && r.viewers.size > 1 ? ` · ${r.viewers.size} profiles` : ''}
                          </div>
                          <div className="top-bar"><div style={{ width: `${((topBy === 'plays' ? r.plays : r.min) / topMax) * 100}%` }} /></div>
                        </td>
                        <td className="num">{r.plays.toLocaleString()}</td>
                        <td className="num nowrap">{fmtHours(r.min)}</td>
                        <td className="muted small nowrap">{timeAgo(r.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <div className="stats-grid">
              <section className="card">
                <h3>By day of week</h3>
                <Columns data={s.weekday} metric={metric} height={110} />
              </section>
              <section className="card">
                <h3>By time of day</h3>
                <Columns data={s.hour} metric={metric} height={110} />
              </section>
              <section className="card">
                <h3>By library</h3>
                <Bars rows={s.libs} metric={metric} />
              </section>
              {who === '' && (
                <section className="card">
                  <h3>By profile</h3>
                  <Bars rows={s.accts} metric={metric} />
                </section>
              )}
              {s.devs.length > 0 && (
                <section className="card">
                  <h3>By device</h3>
                  <Bars rows={s.devs} metric={metric} />
                </section>
              )}
              <section className="card">
                <h3>Library progress for {acct!.name}</h3>
                {completion === null ? (
                  <div className="muted small">Counting…</div>
                ) : (
                  <div className="hbars">
                    {completion.filter((c) => c.total).map((c) => (
                      <div key={c.key} className="hbar" title={`${c.watched.toLocaleString()} of ${c.total.toLocaleString()} ${c.unit} watched`}>
                        <div className="ellipsis">{c.title}</div>
                        <div className="track"><div className="bar" style={{ width: `${(c.watched / c.total) * 100}%` }} /></div>
                        <div className="num">{Math.round((c.watched / c.total) * 100)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <p className="muted small">
              Based on Plex's play history (every play counted once it's mostly watched). Watch time counts each play as the title's full length.
              {s.estimated > 0 && ` ${s.estimated === 1 ? '1 play is' : `${s.estimated.toLocaleString()} plays are`} of titles no longer in the library (or since re-added), so their length is estimated from the same show's episodes or a typical length.`}
            </p>
          </div>
        )}
      </main>

      <aside className="sidebar sidebar-right">
        {focus ? (
          <TitlePanel key={focus.ratingKey} item={focus} onReplaced={(_old, fresh) => setFocus(fresh)} />
        ) : (
          <div className="muted pad">Click a title in Most watched to see its details.</div>
        )}
      </aside>
    </div>
  );
}
