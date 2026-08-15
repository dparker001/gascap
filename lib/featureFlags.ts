/**
 * No feature-flag infrastructure exists in GasCap™ yet — this is the
 * simplest maintainable approach for a controlled pilot rollout rather than
 * introducing a new flag system for one feature. Defaults to enabled so it
 * works with zero required config; set the env var to 'false' in Railway to
 * pull it back during the pilot if needed.
 */
export const RENTAL_RETURN_ASSISTANT_ENABLED =
  process.env.RENTAL_RETURN_ASSISTANT_ENABLED !== 'false';
