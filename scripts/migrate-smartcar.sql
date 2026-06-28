-- Smartcar integration fields — safe, all nullable or have defaults
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "smartcarConnected"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "smartcarAddonStatus"    TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarTrialStartedAt" TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarTrialEndsAt"    TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarAddonSubId"     TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarVehicleCount"   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "smartcarId"             TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarAccessToken"    TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarRefreshToken"   TEXT,
  ADD COLUMN IF NOT EXISTS "smartcarTokenExpiry"    TEXT,
  ADD COLUMN IF NOT EXISTS "fuelLevel"              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "fuelLevelAt"            TEXT,
  ADD COLUMN IF NOT EXISTS "fuelRange"              DOUBLE PRECISION;
