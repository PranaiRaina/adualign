'use client';

function getCurrentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

export function normalizeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  if (next === '/login' || next.startsWith('/login?')) return '/';
  return next;
}

function buildLoginRedirectUrl(nextPath?: string): string {
  const next = normalizeNextPath(nextPath ?? getCurrentPathWithSearch());
  return `/login?next=${encodeURIComponent(next)}`;
}

export function redirectToLogin(nextPath?: string) {
  if (typeof window === 'undefined') return;
  window.location.assign(buildLoginRedirectUrl(nextPath));
}
