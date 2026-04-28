import { MetadataRoute } from 'next';

const BASE_URL = 'https://www.gascap.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/settings',
          '/fillups/',
          '/admin',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
