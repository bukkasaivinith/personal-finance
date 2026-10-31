import { useCallback, useEffect, useState } from 'react';
import { loadFinanceData } from '@/lib/finance-api';
import type { FinanceData } from '@/lib/finance';

export function useFinanceData() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setData(await loadFinanceData());
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Something went wrong while loading your records.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loadError, refresh };
}
