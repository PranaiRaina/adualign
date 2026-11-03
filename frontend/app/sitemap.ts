import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/map', '/pricing', '/contact', '/terms', '/privacy', '/disclaimer'].map((path) => ({
    url: `https://www.adualign.com${path === '/' ? '' : path}`,
  }));
}
