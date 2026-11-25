import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../ctx';
import type { Account, HomeUser } from '../types';
import { Modal } from '../components/Modal';

const KIND_LABEL = { owner: 'Plex account', home: 'Plex Home user', token: 'Token' };

export function AccountsPage({ onSelect }: { onSelect: (id: string) => void }) {
  const { accounts, acct, reloadAccounts, notify, busy } = useApp();
  const [server, setServer] = useState<{ serverUrl: string; reachable: boolean; lockedByEnv: boolean } | null>(null);
  const [url, setUrl] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [homeFor, setHomeFor] = useState<Account | null>(null);
  const stopPoll = useRef(false);

  useEffect(() => {
    api.settings().then((s) => (setServer(s), setUrl(s.serverUrl)), (e) => notify(errMsg(e), 'error'));
    return () => {
      stopPoll.current = true;
    };
  }, [notify]);

  const saveServer = async () => {
    const r = await busy('Checking server…', () => api.saveSettings(url));
    if (r) {
      setServer((s) => ({ ...(s ?? { lockedByEnv: false }), serverUrl: r.serverUrl, reachable: true }));
      notify('Connected to Plex server', 'ok');
    }
  };

  const signIn = async () => {
    // Open the window synchronously so popup blockers allow it.
    const win = window.open('', 'plex-auth', 'width=520,height=720');
    setSigningIn(true);
    stopPoll.current = false;
    try {
      const pin = await api.startPin();
      if (win) win.location.href = pin.authUrl;
      else window.open(pin.authUrl, '_blank');
      const started = Date.now();
      while (!stopPoll.current && Date.now() - started < 5 * 60_000) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await api.checkPin(pin.id);
        if (r.done && r.account) {
          win?.close();
          await reloadAccounts();
          notify(`Signed in as ${r.account.name}`, 'ok');
          if (!acct) onSelect(r.account.id);
          return;
        }
        if (win?.closed && Date.now() - started > 4000) {
          // Give Plex one last chance in case the window closed itself after approving.
          const last = await api.checkPin(pin.id);
          if (last.done) {
            await reloadAccounts();
            return;
          }
          notify('Sign-in window was closed');
          return;
        }
      }
    } catch (e) {
      win?.close();
      notify(errMsg(e), 'error');
    } finally {
      setSigningIn(false);
    }
  };

  const remove = async (a: Account) => {
    if (!confirm(`Remove ${a.name} from this app? Nothing changes in Plex.`)) return;
    if (await busy('Removing…', () => api.removeAccount(a.id))) {
      await reloadAccounts();
    }
  };

  const rename = async (a: Account) => {
    const name = prompt('Display name in this app', a.name)?.trim();
    if (name && name !== a.name && (await busy('Saving…', () => api.renameAccount(a.id, name)))) await reloadAccounts();
  };

  return (
    <div className="page narrow">
      <h1>Accounts &amp; server</h1>

      <section className="card">
        <h2>Plex server</h2>
        <p className="muted small">The address this app uses to reach Plex Media Server, for example <code>http://192.168.0.158:32400</code>.</p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveServer();
          }}
        >
          <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://plex-server:32400" disabled={server?.lockedByEnv} />
          <button className="primary" disabled={!url.trim() || server?.lockedByEnv}>Save &amp; test</button>
        </form>
        {server && (
          <div className={`small ${server.reachable ? 'ok-text' : 'error-text'}`}>
            {server.serverUrl ? (server.reachable ? '● Connected' : '● Not reachable') : 'Not set yet'}
            {server.lockedByEnv && <span className="muted"> · set by the PLEX_URL environment variable</span>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Accounts</h2>
        <p className="muted small">
          Each account has its own playlists. Sign in with Plex, then add the other Plex Home profiles from that account. The account that owns the server is marked <strong>server admin</strong>; only it can edit metadata, artwork and collections.
        </p>
        <div className="acct-list">
          {accounts.map((a) => (
            <div key={a.id} className={`acct ${acct?.id === a.id ? 'current' : ''}`}>
              {a.thumb ? <img className="avatar" src={a.thumb} alt="" referrerPolicy="no-referrer" /> : <div className="avatar" />}
              <div className="grow">
                <div>
                  <strong>{a.name}</strong> {a.admin && <span className="tag admin-tag" title="Owns the Plex server: can edit metadata, artwork and collections">server admin</span>}{' '}
                  {acct?.id === a.id && <span className="tag">current</span>}
                </div>
                <div className="muted small">
                  {KIND_LABEL[a.kind]}
                  {a.parentId ? ` · via ${accounts.find((x) => x.id === a.parentId)?.name ?? 'owner'}` : ''}
                </div>
              </div>
              {acct?.id !== a.id && <button onClick={() => onSelect(a.id)}>Use</button>}
              {a.kind !== 'home' && <button onClick={() => setHomeFor(a)}>Home users…</button>}
              <button onClick={() => rename(a)}>Rename</button>
              <button className="danger" onClick={() => remove(a)}>Remove</button>
            </div>
          ))}
          {!accounts.length && <div className="muted">No accounts yet.</div>}
        </div>
        <div className="inline-form">
          <button className="primary" onClick={signIn} disabled={signingIn || !server?.serverUrl}>
            {signingIn ? 'Waiting for Plex sign-in…' : 'Sign in with Plex'}
          </button>
          {signingIn && <button onClick={() => (stopPoll.current = true)}>Cancel</button>}
          <button onClick={() => setShowToken(true)} disabled={!server?.serverUrl}>Add with a token…</button>
          {!server?.serverUrl && <span className="muted small">Set the server address first.</span>}
        </div>
      </section>

      <ImageSearchCard />

      {showToken && <TokenDialog onClose={() => setShowToken(false)} onAdded={async (a) => (await reloadAccounts(), !acct && onSelect(a.id))} />}
      {homeFor && <HomeUsersDialog owner={homeFor} onClose={() => setHomeFor(null)} />}
    </div>
  );
}

function TokenDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (a: Account) => void }) {
  const { busy, notify } = useApp();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const submit = async () => {
    const a = await busy('Checking token…', () => api.addToken(token.trim(), name.trim()));
    if (a) {
      notify(`Added ${a.name}`, 'ok');
      onAdded(a);
      onClose();
    }
  };
  return (
    <Modal
      title="Add an account with a token"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!token.trim()} onClick={submit}>Add</button>
        </>
      }
    >
      <p className="muted small">
        Use this if Plex sign-in doesn't work for you. Paste an <code>X-Plex-Token</code>; it's stored only on the server running this app.
      </p>
      <div className="form-grid">
        <label>
          Token
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label>
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown in the account menu" />
        </label>
      </div>
    </Modal>
  );
}

function HomeUsersDialog({ owner, onClose }: { owner: Account; onClose: () => void }) {
  const { busy, notify, reloadAccounts } = useApp();
  const [users, setUsers] = useState<HomeUser[] | null>(null);
  const [error, setError] = useState('');
  const [pins, setPins] = useState<Record<string, string>>({});

  const load = () => api.homeUsers(owner.id).then(setUsers, (e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.id]);

  const add = async (u: HomeUser) => {
    const a = await busy(`Adding ${u.title}…`, () => api.addHomeUser(owner.id, u.uuid, pins[u.uuid] || undefined));
    if (a) {
      notify(`Added ${a.name}`, 'ok');
      await reloadAccounts();
      load();
    }
  };

  return (
    <Modal title={`Plex Home users of ${owner.name}`} onClose={onClose} footer={<button onClick={onClose}>Done</button>}>
      {error && <div className="banner error">{error}</div>}
      {!users && !error && <div className="muted">Loading…</div>}
      {users?.length === 0 && <div className="muted">No other Plex Home users on this account.</div>}
      <div className="acct-list">
        {users?.map((u) => (
          <div key={u.uuid} className="acct">
            {u.thumb ? <img className="avatar" src={u.thumb} alt="" referrerPolicy="no-referrer" /> : <div className="avatar" />}
            <div className="grow">
              <strong>{u.title}</strong>
              <div className="muted small">
                {[u.admin && 'admin', u.restricted && 'managed', u.protected && 'PIN protected'].filter(Boolean).join(' · ') || 'Home user'}
              </div>
            </div>
            {u.addedAs ? (
              <span className="tag">added</span>
            ) : (
              <>
                {u.protected && (
                  <input
                    className="pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="PIN"
                    value={pins[u.uuid] ?? ''}
                    onChange={(e) => setPins((p) => ({ ...p, [u.uuid]: e.target.value.replace(/\D/g, '') }))}
                  />
                )}
                <button className="primary" onClick={() => add(u)} disabled={u.protected && (pins[u.uuid]?.length ?? 0) !== 4}>
                  Add
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="muted small">Their PIN is used once to get a token and is not saved.</p>
    </Modal>
  );
}

function ImageSearchCard() {
  const { busy, notify } = useApp();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.imageSearchStatus>> | null>(null);
  const [key, setKey] = useState('');

  const load = () => api.imageSearchStatus().then(setStatus, (e) => notify(errMsg(e), 'error'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const r = await busy('Checking key with SerpApi…', () => api.saveImageSearchKey(key.trim()));
    if (r) {
      setKey('');
      notify('Image search is ready', 'ok');
      load();
    }
  };
  const remove = async () => {
    if (!confirm('Remove the SerpApi key from this app?')) return;
    if (await busy('Removing…', () => api.removeImageSearchKey())) load();
  };

  return (
    <section className="card">
      <h2>Image search</h2>
      <p className="muted small">
        Lets the Artwork window search Google Images for you (through{' '}
        <a href="https://serpapi.com/" target="_blank" rel="noreferrer">SerpApi</a>). The free SerpApi plan includes 250 searches a month, and
        this app remembers each search for a day so repeats are free. The key is stored only on the server running this app.
      </p>
      {status?.configured ? (
        <>
          <div className={`small ${status.error ? 'error-text' : 'ok-text'}`}>
            {status.error ? `● ${status.error}` : '● Connected'}
            {status.plan && <span className="muted"> · {status.plan} plan</span>}
            {status.searchesLeft !== undefined && (
              <span className="muted"> · {status.searchesLeft.toLocaleString()} searches left{status.perMonth ? ` of ${status.perMonth.toLocaleString()} this month` : ''}</span>
            )}
            {status.lockedByEnv && <span className="muted"> · set by the SERPAPI_KEY environment variable</span>}
          </div>
          {!status.lockedByEnv && (
            <div className="inline-form">
              <button className="danger" onClick={remove}>Remove key</button>
            </div>
          )}
        </>
      ) : (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save();
          }}
        >
          <input
            className="grow"
            type="password"
            autoComplete="off"
            placeholder="Paste your SerpApi API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="primary" disabled={!key.trim()}>Save &amp; test</button>
        </form>
      )}
    </section>
  );
}
