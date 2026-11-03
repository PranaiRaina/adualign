import { NextResponse, type NextRequest } from 'next/server';

const listingMarketplaceEnabled = process.env.NEXT_PUBLIC_ENABLE_LISTING_MARKETPLACE === 'true';

export function proxy(request: NextRequest) {
  if (listingMarketplaceEnabled) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/map', request.url));
}

export const config = {
  matcher: ['/marketplace/:path*', '/editor/:path*', '/dashboard/saved/:path*', '/onboarding'],
};
