import { useCallback, useEffect, useState } from 'react';
import { loadFinanceData } from '@/lib/finance-api';
import type { FinanceData } from '@/lib/finance';

export function useFinanceData(workspaceOwnerId: string | null) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loadedForOwnerId, setLoadedForOwnerId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    if (!workspaceOwnerId) {
      setData(null);
      setLoadedForOwnerId(null);
      setLoadError('');
      return;
    }
    try {
      const next = await loadFinanceData(workspaceOwnerId);
      setData(next);
      setLoadedForOwnerId(workspaceOwnerId);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Something went wrong while loading your records.');
    }
  }, [workspaceOwnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data: loadedForOwnerId === workspaceOwnerId ? data : null, loadError, refresh };
}
