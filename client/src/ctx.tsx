import { createContext, useContext } from 'react';
import type { Account } from './types';

export interface AppContext {
  accounts: Account[];
  acct: Account | undefined;
  reloadAccounts: () => Promise<void>;
  notify: (msg: string, kind?: 'ok' | 'error') => void;
  /** Editors register unsaved changes here so navigation can warn first. */
  setDirty: (dirty: boolean) => void;
  confirmLeave: () => boolean;
  /** Run a long operation behind a blocking "working" overlay. */
  busy: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

export const Ctx = createContext<AppContext>(null as unknown as AppContext);
export const useApp = () => useContext(Ctx);
