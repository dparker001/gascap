'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ReferralData {
  code:             string;
  referralUrl:      string;
  referralCount:    number;
  proMonthsEarned:  number;
  referredBy:       string | null;
  maxReferrals:     number;
  reachedCap:       boolean;
  canRefer:         boolean;
  redeemableMonths: number;
  userPlan:         string;
}

export default function ReferralCard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch('/api/referral')
      .then((r) => r.json())
      .then((d: ReferralData) => setData(d))
      .catch(() => {/* silent */})
      .finally(() => setLoading(false));
  }, [session]);

  async function handleCopy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in a temp input
      const el = document.createElement('input');
      el.value = data.referralUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleShare() {
    if (!data) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'GasCap™ — Know before you go',
          text:  'Track your fuel spending & MPG with GasCap. Use my link to sign up:',
          url:   data.referralUrl,
        });
      } catch { /* user cancelled */ }
    } else {
      handleCopy();
    }
  }

  if (!session) return null;

  const isPaid   = data ? (data.userPlan === 'pro' || data.userPlan === 'fleet') : false;
  const canRefer = data?.canRefer ?? false;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔗</span>
          <div>
            <p className="text-sm font-black text-white">Refer &amp; Earn</p>
            <p className="text-[10px] text-amber-100">
              1 free Pro month per friend who verifies &amp; joins · up to 10
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <div className="space-y-2">
            <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-8 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        )}

        {/* ── Free-user upgrade wall ── */}
        {data && !canRefer && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4 text-center space-y-2">
            <p className="text-2xl">🔒</p>
            <p className="text-sm font-black text-amber-800">Pro feature</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Upgrade to <strong>Pro</strong> or <strong>Fleet</strong> to unlock your referral link and earn free months for every friend who joins.
            </p>
            <a
              href="/pricing"
              className="inline-block mt-1 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-black transition-colors"
            >
              Upgrade to Pro →
            </a>
            {data.referredBy && (
              <p className="text-[10px] text-green-600 font-semibold pt-1">
                ✓ You were referred by code <span className="font-mono">{data.referredBy}</span>
              </p>
            )}
          </div>
        )}

        {data && canRefer && (
          <>
            {/* Stats row */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-black text-slate-700">{data.referralCount}</p>
                <p className="text-[10px] text-slate-400 font-semibold">Friends Joined</p>
              </div>
              <div className={[
                'flex-1 rounded-xl px-3 py-2.5 text-center',
                data.proMonthsEarned > 0 ? 'bg-amber-50' : 'bg-slate-50',
              ].join(' ')}>
                <p className={[
                  'text-lg font-black',
                  data.proMonthsEarned > 0 ? 'text-amber-600' : 'text-slate-400',
                ].join(' ')}>
                  {data.proMonthsEarned}
                </p>
                <p className="text-[10px] text-slate-400 font-semibold">Pro Months Earned</p>
              </div>
            </div>

            {/* Progress bar toward 10-referral cap */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                  Referral Progress
                </span>
                <span className={[
                  'text-[10px] font-bold',
                  data.reachedCap ? 'text-green-600' : 'text-slate-400',
                ].join(' ')}>
                  {data.reachedCap ? '🎉 Max reached!' : `${data.referralCount} / ${data.maxReferrals}`}
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={[
                    'h-full rounded-full transition-all duration-500',
                    data.reachedCap ? 'bg-green-400' : 'bg-amber-400',
                  ].join(' ')}
                  style={{ width: `${Math.min((data.referralCount / data.maxReferrals) * 100, 100)}%` }}
                />
              </div>
              {!data.reachedCap && (
                <p className="text-[10px] text-slate-400 mt-1">
                  {data.maxReferrals - data.referralCount} more friend{data.maxReferrals - data.referralCount !== 1 ? 's' : ''} for a free year of Pro
                </p>
              )}
            </div>

            {/* Credit status — plan-aware */}
            {data.proMonthsEarned > 0 && (
              <div className={[
                'rounded-xl px-3 py-2.5 flex items-start gap-2.5',
                isPaid ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200',
              ].join(' ')}>
                <span className="text-base flex-shrink-0">{isPaid ? '✅' : '⏳'}</span>
                <div>
                  {isPaid ? (
                    <>
                      <p className="text-xs font-black text-green-800">
                        {data.proMonthsEarned} month{data.proMonthsEarned !== 1 ? 's' : ''} of Pro credits active
                      </p>
                      <p className="text-[10px] text-green-700 mt-0.5 leading-relaxed">
                        Your credits will be applied to your next billing cycle. Contact support to apply immediately.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-black text-amber-800">
                        {data.proMonthsEarned} month{data.proMonthsEarned !== 1 ? 's' : ''} of Pro credits pending
                      </p>
                      <p className="text-[10px] text-amber-700 mt-0.5 leading-relaxed">
                        Credits apply automatically when you upgrade to Pro or Fleet. Your friends are saving you money!
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Referral link */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                Your referral link
              </label>
              <div className="flex gap-1.5">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 overflow-hidden">
                  <p className="text-[11px] font-mono text-slate-600 truncate">{data.referralUrl}</p>
                </div>
                <button
                  onClick={handleCopy}
                  className={[
                    'flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all',
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-slate-200 text-slate-600 hover:bg-amber-100 hover:text-amber-700',
                  ].join(' ')}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            </div>

            {/* Share button — hidden if cap reached */}
            {!data.reachedCap && (
              <button
                onClick={handleShare}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-black transition-colors flex items-center justify-center gap-2"
              >
                <span>📤</span>
                Share with a Friend
              </button>
            )}

            {data.reachedCap && (
              <div className="w-full py-2.5 rounded-xl bg-green-500 text-white text-sm font-black flex items-center justify-center gap-2">
                <span>🎉</span>
                You've maxed out your referral rewards!
              </div>
            )}

            {/* Footer tip */}
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              Reward triggers when your friend verifies their email.
              {isPaid
                ? ' Credits offset your next billing cycle.'
                : ' Credits are saved and apply when you upgrade.'}
            </p>

            {data.referredBy && (
              <p className="text-[10px] text-green-600 text-center font-semibold">
                ✓ You were referred by code <span className="font-mono">{data.referredBy}</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
