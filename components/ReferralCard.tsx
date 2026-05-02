'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ReferredUser {
  name:     string;
  email:    string;
  joinedAt: string;
  verified: boolean;
  credited: boolean;
}

type AmbassadorTier = 'supporter' | 'ambassador' | 'elite' | null;
interface Thresholds { SUPPORTER: number; AMBASSADOR: number; ELITE: number }

interface ReferralData {
  code:                string;
  referralUrl:         string;
  betaReferralUrl:     string | null;
  isBeta:              boolean;
  referralCount:       number;
  proMonthsEarned:     number;
  referredBy:          string | null;
  referredByName:      string | null;
  ambassadorTier:      AmbassadorTier;
  entryMultiplier:     number;
  ambassadorProForLife: boolean;
  thresholds:          Thresholds;
  maxRedeemAtOnce:     number;
  canRefer:            boolean;
  activeCredits:       number;
  redeemableMonths:    number;
  nextExpiryDate:      string | null;
  userPlan:            string;
  isPaid:              boolean;
  referredUsers:       ReferredUser[];
}

const TIER_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  supporter:  { icon: '⭐', label: 'Supporter',  color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200'  },
  ambassador: { icon: '🏆', label: 'Ambassador', color: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200'   },
  elite:      { icon: '👑', label: 'Elite',       color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
};

function tierProgress(
  count: number,
  t: Thresholds,
): { pct: number; toNext: number; nextKey: string; nextLabel: string } | null {
  if (count < t.SUPPORTER) {
    return { pct: Math.round((count / t.SUPPORTER) * 100), toNext: t.SUPPORTER - count, nextKey: 'supporter', nextLabel: 'Supporter' };
  }
  if (count < t.AMBASSADOR) {
    return {
      pct:       Math.round(((count - t.SUPPORTER)  / (t.AMBASSADOR - t.SUPPORTER))  * 100),
      toNext:    t.AMBASSADOR - count,
      nextKey:   'ambassador',
      nextLabel: 'Ambassador',
    };
  }
  if (count < t.ELITE) {
    return {
      pct:       Math.round(((count - t.AMBASSADOR) / (t.ELITE - t.AMBASSADOR)) * 100),
      toNext:    t.ELITE - count,
      nextKey:   'elite',
      nextLabel: 'Elite',
    };
  }
  return null; // already Elite
}

export default function ReferralCard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const [showQR,  setShowQR]  = useState(false);

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

  async function handleShare() {
    if (!data) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'GasCap™ — Know before you go',
          text:  'Track your fuel spending & MPG with GasCap™. Use my link to sign up:',
          url:   data.referralUrl,
        });
      } catch { /* user cancelled */ }
    } else {
      handleCopy();
    }
  }

  if (!session) return null;

  const tierCfg  = data?.ambassadorTier ? TIER_CONFIG[data.ambassadorTier] : null;
  const progress = data ? tierProgress(data.referralCount, data.thresholds) : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Navy header strip */}
      <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
        <span className="text-sm" aria-hidden="true">🔗</span>
        <div>
          <p className="text-xs font-black text-white uppercase tracking-wider">Refer &amp; Earn</p>
          <p className="text-[10px] text-white/50">
            Free Pro months · bonus drawing entries · lifetime Pro access
          </p>
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
            {/* Ambassador tier badge */}
            {tierCfg && (
              <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 border ${tierCfg.bg} ${tierCfg.border}`}>
                <span className="text-xl flex-shrink-0">{tierCfg.icon}</span>
                <div className="min-w-0">
                  <p className={`text-xs font-black ${tierCfg.color}`}>
                    {tierCfg.label} Ambassador
                    {data.ambassadorProForLife && (
                      <span className="ml-1.5 text-[9px] font-bold bg-white/60 px-1.5 py-0.5 rounded-full">
                        Pro for Life ✓
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    {data.entryMultiplier}× daily drawing entries · always eligible to win
                  </p>
                </div>
              </div>
            )}

            {/* Stats row */}
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-50 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-black text-slate-700">{data.referralCount}</p>
                <p className="text-[10px] text-slate-400 font-semibold">Paying Referrals</p>
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

            {/* Ambassador tier progress */}
            {progress ? (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    Next: {TIER_CONFIG[progress.nextKey].icon} {progress.nextLabel}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {data.referralCount} / {data.referralCount + progress.toNext}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(progress.pct, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  {progress.toNext} more paying referral{progress.toNext !== 1 ? 's' : ''} to unlock {progress.nextLabel}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-purple-50 border border-purple-200 px-3 py-2.5 text-center">
                <p className="text-xs font-black text-purple-700">
                  👑 Elite Ambassador — maximum tier reached!
                </p>
              </div>
            )}

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
                        Credits apply to your next billing cycle. Contact us at admin@gascap.app to apply immediately.
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

            {/* Free user with no credits — upgrade nudge */}
            {!data.isPaid && data.activeCredits === 0 && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-center space-y-1">
                <p className="text-xs font-black text-slate-700">Start referring today</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Earn a free month for every friend who upgrades to Pro — plus bonus drawing entries and a path to lifetime Pro access.
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

            {/* QR code button */}
            <button
              onClick={() => setShowQR(true)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-amber-600 transition-colors"
            >
              <span>📷</span>
              <span>Show QR Code</span>
            </button>

            {/* QR code modal */}
            {showQR && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
                onClick={() => setShowQR(false)}
              >
                <div
                  className="bg-white rounded-3xl p-6 w-full max-w-xs flex flex-col items-center gap-4 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm font-black text-slate-700">Your Referral QR Code</p>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=6&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(data.referralUrl)}`}
                    alt="Referral QR code"
                    width={240}
                    height={240}
                    className="rounded-2xl border border-slate-200"
                  />
                  <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                    Have a friend scan this to sign up with your referral link
                  </p>
                  <a
                    href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&color=0f1f34&bgcolor=ffffff&data=${encodeURIComponent(data.referralUrl)}`}
                    download="gascap-referral-qr.png"
                    className="text-[11px] font-bold text-amber-600 hover:text-amber-500 transition-colors"
                  >
                    ⬇ Download QR Image
                  </a>
                  <button
                    onClick={() => setShowQR(false)}
                    className="w-full py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-sm font-black text-slate-600 transition-colors"
                  >
                    Close QR Code
                  </button>
                </div>
              </div>
            )}

            {/* Share button — always shown */}
            <button
              onClick={handleShare}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-black transition-colors flex items-center justify-center gap-2"
            >
              <span>📤</span>
              Share with a Friend
            </button>

            {/* Referred users list */}
            {data.referredUsers.length > 0 && (
              <details className="group">
                <summary className="text-[11px] font-bold text-amber-600 cursor-pointer list-none flex items-center gap-1.5 hover:text-amber-500 transition-colors">
                  <span className="text-base">👥</span>
                  {data.referredUsers.length} friend{data.referredUsers.length !== 1 ? 's' : ''} referred — tap to view
                </summary>
                <div className="mt-2 space-y-1.5">
                  {data.referredUsers.map((r) => (
                    <div key={r.email} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-700">{r.name}</p>
                        <p className="text-[10px] text-slate-400">{new Date(r.joinedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-1.5">
                        {r.verified ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-100 text-green-600">✓ Verified</span>
                        ) : (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Pending</span>
                        )}
                        {r.credited && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">💳 Paid</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Footer */}
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              Rewards apply when your referred friend upgrades to a paid plan · credits valid for 12 months
            </p>

            {data.referredBy && (
              <p className="text-[10px] text-green-600 text-center font-semibold">
                ✓ You were referred by{' '}
                {data.referredByName
                  ? <span className="font-bold">{data.referredByName}</span>
                  : <span className="font-mono">{data.referredBy}</span>
                }
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
