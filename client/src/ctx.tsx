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

/**
 * Metadata, artwork and collections are changed through the server admin account (the server
 * does that), so any profile can manage them as long as an admin account has been added.
 */
export function useCanManageLibrary() {
  const { acct, accounts } = useApp();
  return !!acct?.admin || accounts.some((a) => a.admin);
}
