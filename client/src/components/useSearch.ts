import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import type { SearchHub } from '../types';

/** Debounced library search for one account. */
export function useSearch(acctId: string | undefined, query: string, delay = 300) {
  const [hubs, setHubs] = useState<SearchHub[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (!acctId || q.length < 2) {
      setHubs([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(acctId, q).then(
        (h) => live && (setHubs(h), setError('')),
        (e) => live && setError(errMsg(e)),
      ).finally(() => live && setLoading(false));
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [acctId, query, delay]);

  return { hubs, loading, error };
}
