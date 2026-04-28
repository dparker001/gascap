import { MetadataRoute } from 'next';

// Always use the canonical www domain — never localhost or bare gascap.app
const BASE_URL = 'https://www.gascap.app';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url:             BASE_URL,
      lastModified:    new Date(),
      changeFrequency: 'weekly',
      priority:        1.0,
    },
    {
      url:             `${BASE_URL}/signup`,
      lastModified:    new Date(),
      changeFrequency: 'monthly',
      priority:        0.9,
    },
    {
      url:             `${BASE_URL}/signin`,
      lastModified:    new Date(),
      changeFrequency: 'monthly',
      priority:        0.5,
    },
    {
      url:             `${BASE_URL}/help`,
      lastModified:    new Date(),
      changeFrequency: 'monthly',
      priority:        0.7,
    },
    {
      url:             `${BASE_URL}/giveaway`,
      lastModified:    new Date(),
      changeFrequency: 'monthly',
      priority:        0.6,
    },
    {
      url:             `${BASE_URL}/sweepstakes-rules`,
      lastModified:    new Date(),
      changeFrequency: 'yearly',
      priority:        0.4,
    },
    {
      url:             `${BASE_URL}/amoe`,
      lastModified:    new Date(),
      changeFrequency: 'yearly',
      priority:        0.3,
    },
    {
      url:             `${BASE_URL}/privacy`,
      lastModified:    new Date(),
      changeFrequency: 'yearly',
      priority:        0.3,
    },
    {
      url:             `${BASE_URL}/terms`,
      lastModified:    new Date(),
      changeFrequency: 'yearly',
      priority:        0.3,
    },
  ];
}
