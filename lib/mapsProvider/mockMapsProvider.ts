/**
 * GasCap™ — Mock Maps Provider (development & future testing)
 *
 * Returns deterministic mock data without requiring a real API key.
 * Useful for local development and for writing tests when a test
 * framework is added.
 *
 * Usage:
 *   import { mockMapsProvider } from '@/lib/mapsProvider/mockMapsProvider';
 *   const route = await mockMapsProvider.getRoute({ ... });
 */

import { milesToMeters } from '@/lib/tripFuelPlanner';
import type {
  IMapsProvider,
  RouteRequest,
  RouteResult,
  FuelStopSearchRequest,
  FuelStop,
} from './types';

export const mockMapsProvider: IMapsProvider = {
  name: 'mock',

  isAvailable(): boolean {
    return true;
  },

  async getRoute(_req: RouteRequest): Promise<RouteResult> {
    // Simulate a short network delay
    await new Promise((r) => setTimeout(r, 200));

    const mockMiles = 150;
    return {
      distanceMeters:  milesToMeters(mockMiles),
      durationSeconds: mockMiles * 72, // ~50 mph average
      polyline:        'mock_polyline_abc123',
      legs: [
        {
          distanceMeters:  milesToMeters(mockMiles),
          durationSeconds: mockMiles * 72,
          startLocation:   { latitude: 28.5381, longitude: -81.3792 },  // Orlando, FL
          endLocation:     { latitude: 30.3322, longitude: -81.6557 },  // Jacksonville, FL
        },
      ],
      provider: 'mock',
    };
  },

  async searchFuelStops(_req: FuelStopSearchRequest): Promise<FuelStop[]> {
    await new Promise((r) => setTimeout(r, 150));

    // NOTE: These are entirely fictional — do not display to users in production.
    return [
      {
        name:                    'Mock Fuel Stop Alpha',
        latitude:                29.1831,
        longitude:               -81.0425,
        address:                 '100 Test Blvd, Daytona Beach, FL 32114',
        placeId:                 'mock_place_id_alpha',
        rating:                  4.2,
        priceLevel:              2,
        distanceFromRouteMeters: 180,
        provider:                'mock',
      },
      {
        name:                    'Mock Fuel Stop Beta',
        latitude:                29.7604,
        longitude:               -81.2748,
        address:                 '200 Demo Ave, Palatka, FL 32177',
        placeId:                 'mock_place_id_beta',
        rating:                  3.8,
        priceLevel:              1,
        distanceFromRouteMeters: 420,
        provider:                'mock',
      },
    ];
  },
};
