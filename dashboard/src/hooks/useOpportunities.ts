import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getChanges, getOpportunities } from '../api';
import type { Counts, Filters, Opportunity } from '../types';

const POLL_MS = 3000;

const ZERO_COUNTS: Counts = { opportunities: 0, submitted: 0, content: 0 };

/**
 * Loads the queue for the current filters and keeps it fresh by polling the
 * bridge's data_version counter (cheap: one integer over loopback every 3 s);
 * a full refetch only happens when SQLite actually changed.
 */
export function useOpportunities(filters: Filters, hasToken: boolean) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [counts, setCounts] = useState<Counts>(ZERO_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped whenever data_version moves — lets non-queue views refetch too.
  const [dataTick, setDataTick] = useState(0);
  const dataVersion = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      setOpportunities(await getOpportunities(filters));
      setError(null);
      setAuthFailed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthFailed(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Refetch on filter change (and on mount / token change).
  useEffect(() => {
    if (!hasToken) { setLoading(false); return; }
    setLoading(true);
    void refetch();
  }, [refetch, hasToken]);

  // data_version poll (also carries the sidebar badge counts).
  useEffect(() => {
    if (!hasToken) return;
    const timer = setInterval(async () => {
      try {
        const { dataVersion: v, counts: c } = await getChanges();
        if (dataVersion.current !== null && v !== dataVersion.current) {
          void refetch();
          setDataTick(t => t + 1);
        }
        dataVersion.current = v;
        // Tolerate an older bridge that predates counts — never blank the UI.
        setCounts(c ?? ZERO_COUNTS);
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setAuthFailed(true);
        else setError('bridge unreachable — is `bridge start` running?');
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refetch, hasToken]);

  return { opportunities, counts, error, authFailed, loading, refetch, setOpportunities, dataTick };
}
