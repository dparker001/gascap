'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ReferralData {
  code:             string;
  referralUrl:      string;
  betaReferralUrl:  string | null;
  isBeta:           boolean;
  referralCount:    number;
  proMonthsEarned:  number;
  referredBy:       string | null;
  maxReferrals:     number;
  maxRedeemAtOnce:  number;
  reachedCap:       boolean;
  canRefer:         boolean;
  activeCredits:    number;
  redeemableMonths: number;
  nextExpiryDate:   string | null;
  userPlan:         string;
  isPaid:           boolean;
}

export default function ReferralCard() {
  const { data: session } = useSession();
  const [data,         setData]        = useState<ReferralData | null>(null);
  const [loading,      setLoading]     = useState(false);
  const [copied,       setCopied]      = useState(false);
  const [copiedBeta,   setCopiedBeta]  = useState(false);

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

  async function handleCopyBeta() {
    if (!data?.betaReferralUrl) return;
    try {
      await navigator.clipboard.writeText(data.betaReferralUrl);
      setCopiedBeta(true);
      setTimeout(() => setCopiedBeta(false), 2000);
    } catch {
      const el = document.createElement('input');
      el.value = data.betaReferralUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedBeta(true);
      setTimeout(() => setCopiedBeta(false), 2000);
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

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔗</span>
          <div>
            <p className="text-sm font-black text-white">Refer &amp; Earn</p>
            <p className="text-[10px] text-amber-100">
              1 free Pro month per friend · up to 10 · redeem up to 3 at a time
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

        {data && (
          <>
            {/* Stats row */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-black text-slate-700">{data.referralCount}</p>
                <p className="text-[10px] text-slate-400 font-semibold">Friends Joined</p>
              </div>
              <div className={[
                'flex-1 rounded-xl px-3 py-2.5 text-center',
                data.activeCredits > 0 ? 'bg-amber-50' : 'bg-slate-50',
              ].join(' ')}>
                <p className={[
                  'text-lg font-black',
                  data.activeCredits > 0 ? 'text-amber-600' : 'text-slate-400',
                ].join(' ')}>
                  {data.activeCredits}
                </p>
                <p className="text-[10px] text-slate-400 font-semibold">Credits Available</p>
              </div>
            </div>

            {/* Progress bar */}
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
                  {data.maxReferrals - data.referralCount} more to earn a free month each
                </p>
              )}
            </div>

            {/* Credit status */}
            {data.activeCredits > 0 && (
              <div className={[
                'rounded-xl px-3 py-2.5 flex items-start gap-2.5',
                data.isPaid ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200',
              ].join(' ')}>
                <span className="text-base flex-shrink-0">{data.isPaid ? '✅' : '⏳'}</span>
                <div className="space-y-0.5">
                  {data.isPaid ? (
                    <>
                      <p className="text-xs font-black text-green-800">
                        {data.redeemableMonths} month{data.redeemableMonths !== 1 ? 's' : ''} ready to redeem
                        {data.activeCredits > data.maxRedeemAtOnce && ` (${data.activeCredits} total, max ${data.maxRedeemAtOnce} at once)`}
                      </p>
                      <p className="text-[10px] text-green-700 leading-relaxed">
                        Credits apply to your next billing cycle. Contact us at hello@gascap.app to apply immediately.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-black text-amber-800">
                        {data.activeCredits} month{data.activeCredits !== 1 ? 's' : ''} banked — upgrade to redeem
                      </p>
                      <p className="text-[10px] text-amber-700 leading-relaxed">
                        Credits apply automatically when you upgrade to Pro or Fleet. Up to {data.maxRedeemAtOnce} months redeemable at once.
                      </p>
                    </>
                  )}
                  {data.nextExpiryDate && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      ⚠️ Earliest credit expires {new Date(data.nextExpiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Free user upgrade nudge — only if no credits yet */}
            {!data.isPaid && data.activeCredits === 0 && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-center space-y-1">
                <p className="text-xs font-black text-slate-700">Credits accumulate on any plan</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Refer friends now — your free months bank up and unlock automatically when you upgrade to Pro.
                </p>
                <a
                  href="/upgrade"
                  className="inline-block mt-1 px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-black transition-colors"
                >
                  Upgrade to Pro →
                </a>
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

            {/* Beta invite link — only for beta testers */}
            {data.isBeta && data.betaReferralUrl && (
              <div className="border border-amber-200 rounded-xl p-3 space-y-2 bg-amber-50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🧪</span>
                  <div>
                    <p className="text-xs font-black text-amber-800">Beta Invite Link</p>
                    <p className="text-[10px] text-amber-700 leading-relaxed">
                      Share this link to give friends a 30-day Pro trial + credit you for the referral.
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <div className="flex-1 bg-white border border-amber-200 rounded-xl px-3 py-2 overflow-hidden">
                    <p className="text-[11px] font-mono text-slate-600 truncate">{data.betaReferralUrl}</p>
                  </div>
                  <button
                    onClick={handleCopyBeta}
                    className={[
                      'flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all',
                      copiedBeta
                        ? 'bg-green-500 text-white'
                        : 'bg-amber-500 text-white hover:bg-amber-400',
                    ].join(' ')}
                  >
                    {copiedBeta ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* Share button */}
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

            {/* Footer */}
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              Reward triggers when your friend verifies their email. Credits expire 6 months after earning.
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
