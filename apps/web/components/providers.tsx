'use client';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiErrorBody,
  Organization,
  StaffPermission,
} from '../../../packages/domain/contracts';
export class ApiError extends Error {
  constructor(
    public details: ApiErrorBody,
    public status: number,
  ) {
    super(details.message);
  }
}
export type Row = Record<string, any>;
type User = {
  id: string;
  name: string;
  email: string;
  csrf: string;
  is_staff: boolean;
  mfa_required?: boolean;
  organizations: Organization[];
  staff_permissions: StaffPermission[];
};
type Context = {
  user: User | null;
  loading: boolean;
  toast: (message: string) => void;
  request: <T = any>(
    path: string,
    body?: unknown,
    key?: string,
    signal?: AbortSignal,
  ) => Promise<T>;
  refresh: () => Promise<void>;
  clearPrivateData: () => Promise<void>;
  scope: string;
};
const SessionContext = createContext<Context>(null!);
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Session>{children}</Session>
    </QueryClientProvider>
  );
}
async function fetchJSON<T = any>(
  path: string,
  body?: unknown,
  csrf?: string,
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response
    .json()
    .catch(() => ({ message: 'The server could not be reached. Please try again.' }));
  if (!response.ok) throw new ApiError(data, response.status);
  return data;
}
function Session({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const {
    data,
    isPending,
    error: sessionError,
  } = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) =>
      fetchJSON<{ user: User | null }>('/me', undefined, undefined, undefined, signal),
    refetchInterval: 15000,
  });
  const user = sessionError ? null : data?.user || null;
  const scope = JSON.stringify([
    user?.id,
    user?.csrf,
    user?.organizations,
    user?.staff_permissions,
  ]);
  const previousScope = useRef(scope);
  const clearPrivateData = useCallback(async () => {
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'me',
    };
    await client.cancelQueries(filters);
    client.removeQueries(filters);
  }, [client]);
  useEffect(() => {
    if (previousScope.current !== scope) {
      const oldScope = previousScope.current;
      previousScope.current = scope;
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] === oldScope,
      };
      void client.cancelQueries(filters).then(() => client.removeQueries(filters));
    }
  }, [scope, client]);
  const [message, setMessage] = useState('');
  const request = useCallback(
    <T = any,>(path: string, body?: unknown, key?: string, signal?: AbortSignal) =>
      fetchJSON<T>(path, body, data?.user?.csrf, key, signal),
    [data?.user?.csrf],
  );
  const toast = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? '' : current)), 4500);
  }, []);
  const refresh = useCallback(async () => {
    await client.invalidateQueries();
  }, [client]);
  return (
    <SessionContext.Provider
      value={{ user, loading: isPending, request, toast, refresh, clearPrivateData, scope }}
    >
      <SessionContent key={scope}>{children}</SessionContent>
      {message && (
        <div className="toast" role="status">
          <span>✓</span>
          {message}
          <button onClick={() => setMessage('')} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
    </SessionContext.Provider>
  );
}
function SessionContent({ children }: { children: ReactNode }) {
  return children;
}
export const useSession = () => useContext(SessionContext);
export function useData<T = any>(path: string, enabled = true, initialData?: T) {
  const { request, scope } = useSession();
  const result = useQuery<T>({
    queryKey: [path, scope],
    queryFn: ({ signal }) => request<T>(path, undefined, undefined, signal),
    enabled,
    initialData,
  });
  // Refetch errors must never leave revoked private records visible.
  return { ...result, data: result.error ? undefined : result.data };
}
export function useAction() {
  const { request, refresh, toast } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | Error>('');
  const run = async <T = any,>(
    path: string,
    body: unknown,
    message?: string,
    key?: string,
  ): Promise<T | null> => {
    setBusy(true);
    setError('');
    try {
      const result = await request<T>(path, body, key);
      await refresh();
      if (message) toast(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e : 'Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}
