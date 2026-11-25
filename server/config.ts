import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type AccountKind = 'owner' | 'home' | 'token';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  thumb?: string;
  /** plex.tv token: used to discover Home users and re-fetch server tokens. */
  plexTvToken?: string;
  /** Token used against the Plex Media Server itself. */
  serverToken: string;
  /** Plex user uuid (owner and Home users). */
  uuid?: string;
  /** For Home users: the account id of the owner they were added from. */
  parentId?: string;
  /** True when this account owns the Plex server (can edit metadata and collections). */
  serverOwner?: boolean;
}

export interface Config {
  clientId: string;
  sessionSecret: string;
  serverUrl: string;
  accounts: Account[];
}

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'config.json');

let cfg: Config | undefined;

export function getConfig(): Config {
  if (cfg) return cfg;
  let loaded: Partial<Config> = {};
  try {
    loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    /* first run */
  }
  cfg = {
    clientId: loaded.clientId || crypto.randomUUID(),
    sessionSecret: loaded.sessionSecret || crypto.randomBytes(32).toString('hex'),
    serverUrl: process.env.PLEX_URL || loaded.serverUrl || '',
    accounts: loaded.accounts || [],
  };
  saveConfig();
  return cfg;
}

export function saveConfig() {
  if (!cfg) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function publicAccount(a: Account) {
  // Unknown ownership (token-only accounts): let the UI offer admin tools and let Plex decide.
  const admin = a.serverOwner ?? a.kind !== 'home';
  return { id: a.id, name: a.name, kind: a.kind, thumb: a.thumb, parentId: a.parentId, admin };
}

export function upsertAccount(a: Omit<Account, 'id'> & { id?: string }): Account {
  const c = getConfig();
  const existing = a.uuid ? c.accounts.find((x) => x.uuid === a.uuid) : undefined;
  if (existing) {
    Object.assign(existing, a, { id: existing.id });
    saveConfig();
    return existing;
  }
  const acct: Account = { ...a, id: a.id || crypto.randomBytes(6).toString('hex') };
  c.accounts.push(acct);
  saveConfig();
  return acct;
}
