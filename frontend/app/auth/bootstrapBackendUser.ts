/**
 * Provision/fetch the backend user for a freshly created Supabase session.
 * Shared by the OAuth callback (/auth/callback) and the email confirmation
 * route (/auth/confirm).
 */
export async function bootstrapBackendUser(accessToken: string): Promise<boolean> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    return false;
  }

  const res = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  return res.ok;
}
