/**
 * Minimal type declarations for the `smartcar` npm package.
 * The package ships no TypeScript types; these cover the subset used by GasCap.
 */
declare module 'smartcar' {
  interface AuthClientOptions {
    clientId:     string;
    clientSecret: string;
    redirectUri:  string;
  }

  interface TokenResponse {
    accessToken:  string;
    refreshToken: string;
    expiration?:  Date;  // JS Date of expiry
  }

  interface AuthUrlOptions {
    state?:       string;
    forcePrompt?: boolean;
  }

  class AuthClient {
    constructor(options: AuthClientOptions);
    getAuthUrl(scope: string[], options?: AuthUrlOptions): string;
    exchangeCode(code: string): Promise<TokenResponse>;
    exchangeRefreshToken(refreshToken: string): Promise<TokenResponse>;
  }

  interface VehicleAttributes {
    make:  string;
    model: string;
    year:  number;
  }

  interface VinResponse  { vin: string }
  interface FuelResponse { percentRemaining: number; range: number; amountRemaining: number }
  interface OdometerResponse { distance: number }

  class Vehicle {
    constructor(vehicleId: string, accessToken: string);
    attributes(): Promise<VehicleAttributes>;
    vin():        Promise<VinResponse>;
    fuel():       Promise<FuelResponse>;
    odometer():   Promise<OdometerResponse>;
  }

  function getVehicles(accessToken: string): Promise<{ vehicles: string[] }>;
}
