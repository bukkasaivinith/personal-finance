import { useCallback, useEffect, useState } from 'react';
import { loadWorkspaceAccess, type WorkspaceAccess } from '@/lib/workspace-api';

export function useWorkspaceAccess() {
  const [workspaces, setWorkspaces] = useState<WorkspaceAccess[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await loadWorkspaceAccess();
      setWorkspaces(next.workspaces);
      setIsPlatformAdmin(next.isPlatformAdmin);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'We could not load your workspace access.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { workspaces, isPlatformAdmin, loadError, refresh };
}
