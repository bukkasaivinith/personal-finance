import { createContext, useContext } from 'react';
import type { CurrentFinanceProfile } from '@/lib/auth-api';

export const CurrentFinanceProfileContext = createContext<CurrentFinanceProfile | null>(null);

export function useCurrentFinanceProfile(): CurrentFinanceProfile | null {
  return useContext(CurrentFinanceProfileContext);
}
