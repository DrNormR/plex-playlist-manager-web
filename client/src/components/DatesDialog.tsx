import { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { AutoDateRule, DateOptions, DatePlan } from '../types';
import { plural } from '../util';
import { Modal } from './Modal';

type Show = 'changes' | 'nodate' | 'all';

const optsKey = (sec: string) => `ppm.dates.${sec}`;

function loadOpts(sec: string): DateOptions {
  try {
    const o = JSON.parse(localStorage.getItem(optsKey(sec)) ?? 'null');
    if (o) return { yearOnly: o.yearOnly === 'keep' ? 'keep' : 'jan1', setTitle: !!o.setTitle };
  } catch {
    /* ignore */
  }
  return { yearOnly: 'jan1', setTitle: false };
}

const fileName = (f?: string) => f?.split(/[\\/]/).pop() ?? '';
const hasChanges = (p: DatePlan) => Object.keys(p.set).length > 0;

/** Preview and apply year / release date (and optionally title) from each file name in a library. */
export function DatesDialog({ sec, libraryTitle, onClose, onChanged }: {
  sec: string;
  libraryTitle: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { acct, notify, busy } = useApp();
  const acctId = acct!.id;
  const [opts, setOpts] = useState<DateOptions>(() => loadOpts(sec));
  const [items, setItems] = useState<DatePlan[] | null>(null);
  const [auto, setAuto] = useState<AutoDateRule | null>(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('changes');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ver, setVer] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    api.dateScan(acctId, sec, opts).then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setAuto(r.auto);
        setPicked(new Set(r.items.filter(hasChanges).map((i) => i.ratingKey)));
      },
      (e) => live && setError(errMsg(e)),
    );
    return () => {
      live = false;
    };
  }, [acctId, sec, opts, ver]);

  const changeOpts = (patch: Partial<DateOptions>) => {
    const o = { ...opts, ...patch };
    localStorage.setItem(optsKey(sec), JSON.stringify(o));
    setOpts(o);
  };

  const counts = useMemo(() => {
    const list = items ?? [];
    return { changes: list.filter(hasChanges).length, nodate: list.filter((i) => !i.parsed).length, all: list.length };
  }, [items]);

  const shown = useMemo(() => {
    const list = items ?? [];
    return show === 'changes' ? list.filter(hasChanges) : show === 'nodate' ? list.filter((i) => !i.parsed) : list;
  }, [items, show]);

  const toApply = (items ?? []).filter((i) => picked.has(i.ratingKey) && hasChanges(i));

  const apply = async () => {
    const r = await busy(`Updating ${plural(toApply.length, 'title')}…`, () =>
      api.dateApply(acctId, sec, toApply.map(({ ratingKey, set }) => ({ ratingKey, set }))),
    );
    if (!r) return;
    if (r.failed.length) notify(`${r.changed} updated, ${r.failed.length} failed: ${r.failed[0].error}`, 'error');
    else notify(`Updated ${plural(r.changed, 'title')} in ${libraryTitle}`, 'ok');
    onChanged();
    setVer((v) => v + 1);
  };

  const setAutoOn = async (enabled: boolean) => {
    try {
      setAuto(await api.dateAuto(acctId, sec, enabled, opts));
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  // Keep the automatic rule's options in step with the ones shown here.
  useEffect(() => {
    if (auto && (auto.yearOnly !== opts.yearOnly || auto.setTitle !== opts.setTitle)) {
      api.dateAuto(acctId, sec, true, opts).then(setAuto, () => {});
    }
  }, [opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const runNow = async () => {
    const r = await busy('Checking new titles…', () => api.dateAutoRun(acctId, sec));
    if (!r) return;
    setAuto(r);
    if (r.lastChanged) onChanged();
    setVer((v) => v + 1);
  };

  const togglePick = (rk: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(rk)) n.delete(rk);
      else n.add(rk);
      return n;
    });

  const shownChangeable = shown.filter(hasChanges);
  const allShownPicked = shownChangeable.length > 0 && shownChangeable.every((i) => picked.has(i.ratingKey));

  return (
    <Modal
      title={`Dates from file names — ${libraryTitle}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small grow">Changed fields are locked so a Plex metadata refresh won't undo them.</span>
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={!toApply.length} onClick={apply}>
            Update {plural(toApply.length, 'title')}
          </button>
        </>
      }
    >
      <div className="dates">
        <p className="small muted">
          Reads the date from names like <code>MLB - 2025-11-01 - Dodgers at Blue Jays</code> (full date) or{' '}
          <code>Super Bowl 56 - 2022 - Rams vs. Bengals</code> (year only) and sets each title's <strong>year</strong> and{' '}
          <strong>release date</strong>.
        </p>
        <div className="dates-opts">
          <label className="small">
            Year-only names:{' '}
            <select value={opts.yearOnly} onChange={(e) => changeOpts({ yearOnly: e.target.value as DateOptions['yearOnly'] })}>
              <option value="jan1">set release date to Jan 1 of that year</option>
              <option value="keep">set the year only, leave the release date</option>
            </select>
          </label>
          <label className="small nowrap">
            <input type="checkbox" checked={opts.setTitle} onChange={(e) => changeOpts({ setTitle: e.target.checked })} /> Also set the title to the
            file name
          </label>
        </div>

        <div className="dates-auto">
          <label className="small">
            <input type="checkbox" checked={!!auto} onChange={(e) => setAutoOn(e.target.checked)} />{' '}
            <strong>Automatic:</strong> do this for titles added to {libraryTitle} from now on (checked every 30 minutes, with the options above)
          </label>
          {auto && (
            <div className="small muted">
              {auto.lastRun ? <>Last checked {new Date(auto.lastRun).toLocaleString()}: {plural(auto.lastChanged ?? 0, 'title')} updated</> : 'Not run yet'}
              {auto.totalChanged ? <> · {auto.totalChanged} in total</> : null}
              {auto.lastError && <span className="error-text"> · {auto.lastError}</span>}
              {' · '}
              <button className="link" onClick={runNow}>Check now</button>
            </div>
          )}
        </div>

        {error && <div className="banner error">{error}</div>}
        {!items && !error && <div className="muted pad">Reading {libraryTitle}…</div>}
        {items && (
          <>
            <div className="seg small">
              <button className={show === 'changes' ? 'on' : ''} onClick={() => setShow('changes')}>Needs changes ({counts.changes})</button>
              <button className={show === 'nodate' ? 'on' : ''} onClick={() => setShow('nodate')}>No date in name ({counts.nodate})</button>
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All ({counts.all})</button>
            </div>
            {!shown.length ? (
              <div className="muted pad">{show === 'changes' ? 'Everything already matches its file name.' : 'Nothing to show.'}</div>
            ) : (
              <div className="dates-table">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allShownPicked}
                          disabled={!shownChangeable.length}
                          onChange={() =>
                            setPicked((s) => {
                              const n = new Set(s);
                              shownChangeable.forEach((i) => (allShownPicked ? n.delete(i.ratingKey) : n.add(i.ratingKey)));
                              return n;
                            })
                          }
                          aria-label="Select all shown"
                        />
                      </th>
                      <th>Title / file</th>
                      <th>Now</th>
                      <th>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => {
                      const ch = hasChanges(i);
                      return (
                        <tr key={i.ratingKey} className={ch ? '' : 'muted'} onClick={() => ch && togglePick(i.ratingKey)}>
                          <td>{ch && <input type="checkbox" checked={picked.has(i.ratingKey)} onChange={() => togglePick(i.ratingKey)} onClick={(e) => e.stopPropagation()} />}</td>
                          <td>
                            <div>{i.show ? <span className="muted">{i.show} · </span> : null}{i.title}</div>
                            <div className="muted small ellipsis" title={i.file}>{fileName(i.file)}</div>
                            {i.set.title && <div className="small new-val">→ {i.set.title}</div>}
                          </td>
                          <td className="nowrap small">
                            {i.year ?? '—'}
                            <br />
                            <span className="muted">{i.date ?? 'no date'}</span>
                          </td>
                          <td className="nowrap small">
                            {!i.parsed ? (
                              <span className="muted">no date found</span>
                            ) : (
                              <>
                                <span className={i.set.year ? 'new-val' : ''}>{i.set.year ?? i.year}</span>
                                <br />
                                <span className={i.set.originallyAvailableAt ? 'new-val' : 'muted'}>{i.set.originallyAvailableAt ?? i.date ?? 'no date'}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
