import { useCallback, useEffect, useState } from 'react';
import { loadAthleteHubData } from '@/lib/athlete-api';
import type { AthleteHubData } from '@/lib/athlete';

export function useAthleteData(enabled: boolean) {
  const [data, setData] = useState<AthleteHubData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const refresh = useCallback(async () => {
    if (!enabled) { setData(null); setError(''); setLoading(false); return; }
    setLoading(true);
    try { setData(await loadAthleteHubData()); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load Athlete Hub.'); } finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, loading, refresh };
}
