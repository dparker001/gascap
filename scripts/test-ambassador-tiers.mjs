#!/usr/bin/env node
/**
 * Exercises the Ambassador tier-reward decision logic.
 *
 * These tiers pay out real money ($50/$100/$500 vouchers via Marketing Boost)
 * and have never fired in production — nobody has reached 5 paying referrals.
 * The first person to hit one will be the best advocate GasCap has, which is
 * the worst possible time to discover a bug.
 *
 * Mirrors the predicate in lib/users.ts recordReferral(). Pure decision logic,
 * no sends, no DB.
 *
 *   node scripts/test-ambassador-tiers.mjs
 */
const T = { SUPPORTER: 5, AMBASSADOR: 15, ELITE: 30 };

const tierFor = (n) =>
  n >= T.ELITE ? 'elite' : n >= T.AMBASSADOR ? 'ambassador' : n >= T.SUPPORTER ? 'supporter' : null;
const qualifiesForFreeProForLife = (n) => n >= T.AMBASSADOR;

/** Mirrors the decision in recordReferral(). */
function decide({ current, plan, alreadySent = [] }) {
  const newCount = current + 1;
  const justCrossedAmbassador =
    qualifiesForFreeProForLife(newCount) && !qualifiesForFreeProForLife(current);
  const prevTier = tierFor(current);
  const justCrossedTier = tierFor(newCount);
  const paidOrGranted = plan === 'pro' || plan === 'fleet' || justCrossedAmbassador;
  // ambassadorTierRewardsSent is the replay guard. It used to be written on
  // every payout and never read, so a corrected count or a webhook replay
  // could issue a second real-money voucher.
  const alreadyRewarded = alreadySent.includes(justCrossedTier ?? '');
  const crossedNewTier =
    justCrossedTier !== null && justCrossedTier !== prevTier && paidOrGranted && !alreadyRewarded;
  return { reward: crossedNewTier ? justCrossedTier : null };
}

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
  ok ? pass++ : fail++;
};

console.log('\nTier thresholds');
check('4 -> 5  grants supporter',     decide({ current: 4,  plan: 'pro' }).reward, 'supporter');
check('14 -> 15 grants ambassador',   decide({ current: 14, plan: 'pro' }).reward, 'ambassador');
check('29 -> 30 grants elite',        decide({ current: 29, plan: 'pro' }).reward, 'elite');

console.log('\nNo re-fire inside a tier');
check('5 -> 6   no reward',           decide({ current: 5,  plan: 'pro' }).reward, null);
check('15 -> 16 no reward',           decide({ current: 15, plan: 'pro' }).reward, null);
check('30 -> 31 no reward',           decide({ current: 30, plan: 'pro' }).reward, null);
check('0 -> 1   no reward',           decide({ current: 0,  plan: 'pro' }).reward, null);

console.log('\nAnti-farming: free accounts cannot earn Supporter vouchers');
check('free at 4 -> 5   blocked',     decide({ current: 4,  plan: 'free' }).reward, null);
check('free at 14 -> 15 allowed',     decide({ current: 14, plan: 'free' }).reward, 'ambassador');

console.log('\nMulti-tier jump (count corrected in bulk)');
check('4 -> 16 skips supporter',      decide({ current: 15, plan: 'pro' }).reward, null);
check('  ...lands on ambassador only', decide({ current: 14, plan: 'pro' }).reward, 'ambassador');

console.log('\nReplay protection (ambassadorTierRewardsSent)');
check('re-crossing supporter is blocked',
  decide({ current: 4, plan: 'pro', alreadySent: ['supporter'] }).reward, null);
check('unrelated prior tier does not block',
  decide({ current: 14, plan: 'pro', alreadySent: ['supporter'] }).reward, 'ambassador');
check('elite still fires after both lower tiers',
  decide({ current: 29, plan: 'pro', alreadySent: ['supporter','ambassador'] }).reward, 'elite');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
