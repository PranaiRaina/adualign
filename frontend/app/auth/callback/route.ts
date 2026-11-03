import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { bootstrapBackendUser } from '../bootstrapBackendUser';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/projects';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        const isBootstrapped = await bootstrapBackendUser(session.access_token);
        if (isBootstrapped) {
          return NextResponse.redirect(`${origin}${next}`);
        }
        return NextResponse.redirect(`${origin}/login?error=account_setup_failed`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth_error`);
}
