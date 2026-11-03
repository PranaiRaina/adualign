// Human-readable copy for auth failures. Supabase AuthError codes first,
// message heuristics second, safe generic fallback last — raw API text and
// `{}`-style junk never reach the user.
const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please verify your email before signing in.',
  user_already_exists: 'This email is already registered. Please sign in instead.',
  email_exists: 'This email is already registered. Please sign in instead.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  over_email_send_rate_limit: 'Too many emails sent. Please wait a minute and try again.',
  otp_expired:
    'This link has expired or was already used. Request a new one from the sign-in screen.',
  same_password: 'Your new password must be different from your current one.',
  weak_password: 'Please choose a stronger password (at least 8 characters).',
  user_banned: 'This account has been suspended. Contact us if you think this is a mistake.',
  signup_disabled: 'New signups are temporarily disabled. Please try again later.',
};

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  const message = err instanceof Error ? err.message : '';
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (/rate limit|security purposes/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/expired|invalid/i.test(message) && /token|link|otp/i.test(message)) {
    return CODE_MESSAGES.otp_expired;
  }
  // Our own thrown Errors (plain English, ends in punctuation) pass through.
  if (message && /^[A-Z].*[.!?]$/.test(message)) return message;

  return 'Something went wrong. Please try again.';
}
