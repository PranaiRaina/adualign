import { createClient } from './client';

/**
 * Returns the Authorization header for the current Supabase session, or an empty
 * object when logged out. Spread into a fetch `headers` object to authenticate a
 * backend request:
 *
 *   headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) }
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
