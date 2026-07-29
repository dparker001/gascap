-- Smartcar V3: add smartcarUserId to User table
-- V3 uses app-level client_credentials token + sc-user-id header per user
-- No per-vehicle tokens needed; existing vehicle token fields left in place (unused)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "smartcarUserId" TEXT;
