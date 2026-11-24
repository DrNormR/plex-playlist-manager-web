import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errMsg, setLoginHandler } from './api';
import { Ctx, type AppContext } from './ctx';
import type { Account } from './types';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { SearchPage } from './pages/SearchPage';
import { AccountsPage } from './pages/AccountsPage';

type Tab = 'playlists' | 'collections' | 'search' | 'accounts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'collections', label: 'Collections' },
  { id: 'search', label: 'Search' },
  { id: 'accounts', label: 'Accounts' },
];

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'error' | 'info';
}

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1) as Tab;
  return TABS.some((t) => t.id === h) ? h : 'playlists';
};

export function App() {
  const [session, setSession] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [acctId, setAcctId] = useState(() => localStorage.getItem('ppm.acct') ?? '');
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const dirty = useRef(false);

  const notify = useCallback((msg: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000);
  }, []);

  const reloadAccounts = useCallback(async () => {
    try {
      setAccounts(await api.accounts());
    } catch (e) {
      notify(errMsg(e), 'error');
      setAccounts([]);
    }
  }, [notify]);

  useEffect(() => {
    setLoginHandler(() => setSession((s) => (s ? { ...s, authenticated: false } : s)));
    api.session().then(setSession, () => setSession({ authRequired: false, authenticated: true }));
  }, []);

  useEffect(() => {
    if (session?.authenticated) reloadAccounts();
  }, [session?.authenticated, reloadAccounts]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const acct = accounts?.find((a) => a.id === acctId) ?? accounts?.[0];

  const confirmLeave = useCallback(() => {
    if (!dirty.current) return true;
    if (!confirm('You have unsaved changes. Discard them?')) return false;
    dirty.current = false;
    return true;
  }, []);

  const ctx: AppContext = useMemo(
    () => ({
      accounts: accounts ?? [],
      acct,
      reloadAccounts,
      notify,
      setDirty: (d: boolean) => {
        dirty.current = d;
      },
      confirmLeave,
      busy: async (label, fn) => {
        setBusyLabel(label);
        try {
          return await fn();
        } catch (e) {
          notify(errMsg(e), 'error');
          return undefined;
        } finally {
          setBusyLabel(null);
        }
      },
    }),
    [accounts, acct, reloadAccounts, notify, confirmLeave],
  );

  const go = (t: Tab) => {
    if (t === tab || !confirmLeave()) return;
    location.hash = t;
  };
  const selectAccount = (id: string) => {
    if (id === acct?.id || !confirmLeave()) return;
    setAcctId(id);
    localStorage.setItem('ppm.acct', id);
  };

  if (!session) return <div className="boot">Loading…</div>;
  if (session.authRequired && !session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />;
  if (!accounts) return <div className="boot">Loading…</div>;

  const needsAccount = !acct;
  const shownTab: Tab = needsAccount ? 'accounts' : tab;

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">≡</span> Playlist Manager
          </div>
          <nav>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={shownTab === t.id ? 'on' : ''}
                onClick={() => go(t.id)}
                disabled={needsAccount && t.id !== 'accounts'}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="spacer" />
          {acct && (
            <label className="acct-switch">
              {acct.thumb && <img className="avatar sm" src={acct.thumb} alt="" referrerPolicy="no-referrer" />}
              <select value={acct.id} onChange={(e) => selectAccount(e.target.value)} aria-label="Account">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          )}
          {session.authRequired && (
            <button className="link" onClick={() => api.logout().then(() => setSession({ ...session, authenticated: false }))}>
              Log out
            </button>
          )}
        </header>

        <div className="content">
          {shownTab === 'playlists' && acct && <PlaylistsPage key={acct.id} />}
          {shownTab === 'collections' && acct && <CollectionsPage key={acct.id} />}
          {shownTab === 'search' && acct && <SearchPage key={acct.id} />}
          {shownTab === 'accounts' && <AccountsPage onSelect={selectAccount} />}
        </div>

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              {t.msg}
            </div>
          ))}
        </div>
        {busyLabel && (
          <div className="busy">
            <div className="spinner" />
            {busyLabel}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.login(pw);
            onDone();
          } catch (x) {
            setErr(errMsg(x));
          }
        }}
      >
        <h1>Playlist Manager</h1>
        <input type="password" autoFocus placeholder="App password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="error-text small">{err}</div>}
        <button className="primary">Log in</button>
      </form>
    </div>
  );
}
