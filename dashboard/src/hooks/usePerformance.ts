import { useEffect, useState } from 'react';
import { getPerformance } from '../api';
import type { PerformanceRow } from '../types';

const EMPTY: Map<string, PerformanceRow> = new Map();

/**
 * Performance check-ins keyed by opportunity id, for decorating the Submitted
 * view (Pro). When disabled (free tier, or another view) no request is made and
 * the constant empty map is returned — free users' Submitted tab is untouched.
 * Errors (including a 403 from a stale pro flag) are swallowed the same way.
 */
export function usePerformance(enabled: boolean, dataTick: number): Map<string, PerformanceRow> {
  const [perf, setPerf] = useState<Map<string, PerformanceRow>>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setPerf(EMPTY);
      return;
    }
    let cancelled = false;
    getPerformance()
      .then(rows => {
        if (!cancelled) setPerf(new Map(rows.map(r => [r.id, r])));
      })
      .catch(() => { if (!cancelled) setPerf(EMPTY); });
    return () => { cancelled = true; };
  }, [enabled, dataTick]);

  return perf;
}
