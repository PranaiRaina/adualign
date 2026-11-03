import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard',
        '/projects',
        '/editor',
        '/admin',
        '/report',
        '/onboarding',
        '/adu-chat',
        '/auth',
        '/api',
      ],
    },
    sitemap: 'https://www.adualign.com/sitemap.xml',
  };
}
