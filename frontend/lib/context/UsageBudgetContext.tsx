'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { AuthContext } from '@/lib/context/AuthContext';
import { createClient } from '@/lib/utils/supabase/client';

const RAG_API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const LIFETIME_AI_BUDGET_MICROS = 10_000_000;
const AI_BUDGET_PERIOD = 'lifetime';

type BudgetPeriod = 'lifetime';

interface UsageBudget {
  costUsedMicros: number;
  costBudgetMicros: number;
  addressCreditsRemaining: number;
  budgetCurrency: string;
  budgetPeriod: BudgetPeriod;
  resetsAt: string;
  totalTokensUsed: number;
  promptTokensUsed: number;
  completionTokensUsed: number;
  mapSearchCount: number;
  percentUsed: number;
  isExhausted: boolean;
  isLoaded: boolean;
  refresh: () => void;
}

const DEFAULT_BUDGET: UsageBudget = {
  costUsedMicros: 0,
  costBudgetMicros: 0,
  addressCreditsRemaining: 0,
  budgetCurrency: 'USD',
  budgetPeriod: AI_BUDGET_PERIOD,
  resetsAt: '',
  totalTokensUsed: 0,
  promptTokensUsed: 0,
  completionTokensUsed: 0,
  mapSearchCount: 0,
  percentUsed: 0,
  isExhausted: false,
  isLoaded: false,
  refresh: () => {},
};

const UsageBudgetContext = createContext<UsageBudget>(DEFAULT_BUDGET);

export function useBudget() {
  return useContext(UsageBudgetContext);
}

function isSupportedBudgetResponse(status: number): boolean {
  return ![404, 405, 501].includes(status);
}

export function UsageBudgetProvider({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const supabaseRef = useRef(createClient());
  const [costUsedMicros, setCostUsedMicros] = useState(0);
  const [costBudgetMicros, setCostBudgetMicros] = useState(0);
  const [addressCreditsRemaining, setAddressCreditsRemaining] = useState(0);
  const [budgetCurrency, setBudgetCurrency] = useState('USD');
  const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod>(AI_BUDGET_PERIOD);
  const [resetsAt, setResetsAt] = useState('');
  const [totalTokensUsed, setTotalTokensUsed] = useState(0);
  const [promptTokensUsed, setPromptTokensUsed] = useState(0);
  const [completionTokensUsed, setCompletionTokensUsed] = useState(0);
  const [mapSearchCount, setMapSearchCount] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBudgetState = useCallback(() => {
    setCostUsedMicros(0);
    setCostBudgetMicros(0);
    setAddressCreditsRemaining(0);
    setBudgetCurrency('USD');
    setBudgetPeriod(AI_BUDGET_PERIOD);
    setResetsAt('');
    setTotalTokensUsed(0);
    setPromptTokensUsed(0);
    setCompletionTokensUsed(0);
    setMapSearchCount(0);
    setIsLoaded(false);
  }, []);

  const markBudgetUnavailable = useCallback(() => {
    setCostUsedMicros(0);
    setCostBudgetMicros(0);
    setAddressCreditsRemaining(0);
    setBudgetCurrency('USD');
    setBudgetPeriod(AI_BUDGET_PERIOD);
    setResetsAt('');
    setTotalTokensUsed(0);
    setPromptTokensUsed(0);
    setCompletionTokensUsed(0);
    setMapSearchCount(0);
    setIsLoaded(true);
  }, []);

  const fetchBudget = useCallback(async () => {
    if (!auth?.isLoggedIn || auth.isLoading) {
      resetBudgetState();
      return;
    }

    if (!isSupported || !RAG_API_URL) {
      markBudgetUnavailable();
      return;
    }

    try {
      const {
        data: { session },
      } = await supabaseRef.current.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
        bootstrapRetryRef.current = setTimeout(() => {
          void fetchBudget();
        }, 300);
        return;
      }

      const res = await fetch(`${RAG_API_URL}/usage/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // Fail-open: don't block the user on infra errors
        if (!isSupportedBudgetResponse(res.status)) {
          setIsSupported(false);
        }
        markBudgetUnavailable();
        return;
      }

      const data = await res.json();
      setCostUsedMicros(data.cost_used_micros ?? 0);
      setCostBudgetMicros(data.cost_budget_micros ?? LIFETIME_AI_BUDGET_MICROS);
      setAddressCreditsRemaining(data.address_credit_balance ?? 0);
      setBudgetCurrency(data.budget_currency ?? 'USD');
      setBudgetPeriod(
        data.budget_period === AI_BUDGET_PERIOD ? data.budget_period : AI_BUDGET_PERIOD,
      );
      setResetsAt(data.resets_at ?? '');
      setTotalTokensUsed(data.total_tokens_used ?? data.tokens_used ?? 0);
      setPromptTokensUsed(data.prompt_tokens_used ?? 0);
      setCompletionTokensUsed(data.completion_tokens_used ?? 0);
      setMapSearchCount(data.map_search_count ?? 0);
      setIsLoaded(true);
    } catch {
      // Fail-open: hide the meter entirely on fetch failure
      markBudgetUnavailable();
    }
  }, [auth?.isLoggedIn, auth?.isLoading, isSupported, markBudgetUnavailable, resetBudgetState]);

  const refresh = useCallback(() => {
    if (!auth?.isLoggedIn) return;
    if (!isSupported || !RAG_API_URL) {
      markBudgetUnavailable();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchBudget();
    }, 500);
  }, [auth?.isLoggedIn, fetchBudget, isSupported, markBudgetUnavailable]);

  // Initial fetch on mount when authenticated
  useEffect(() => {
    if (!auth?.isLoggedIn) {
      resetBudgetState();
      return;
    }

    if (auth.isLoading) {
      return;
    }

    if (!isSupported || !RAG_API_URL) {
      markBudgetUnavailable();
      return;
    }

    void fetchBudget();
  }, [
    auth?.isLoggedIn,
    auth?.isLoading,
    fetchBudget,
    isSupported,
    markBudgetUnavailable,
    resetBudgetState,
  ]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
    };
  }, []);

  const percentUsed = costBudgetMicros > 0 ? (costUsedMicros / costBudgetMicros) * 100 : 0;
  const isExhausted = costBudgetMicros > 0 && costUsedMicros >= costBudgetMicros;

  return (
    <UsageBudgetContext.Provider
      value={{
        costUsedMicros,
        costBudgetMicros,
        addressCreditsRemaining,
        budgetCurrency,
        budgetPeriod,
        resetsAt,
        totalTokensUsed,
        promptTokensUsed,
        completionTokensUsed,
        mapSearchCount,
        percentUsed,
        isExhausted,
        isLoaded,
        refresh,
      }}
    >
      {children}
    </UsageBudgetContext.Provider>
  );
}
