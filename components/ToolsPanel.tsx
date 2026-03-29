'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import AiAdvisor             from './AiAdvisor';
import TripCostEstimator     from './TripCostEstimator';
import FillupHistory         from './FillupHistory';
import MonthlyBudgetGoal     from './MonthlyBudgetGoal';
import MpgChart              from './MpgChart';
import FuelPriceHistory      from './FuelPriceHistory';
import NationalGasPriceChart  from './NationalGasPriceChart';
import VehicleSpendingBreakdown from './VehicleSpendingBreakdown';
import VehicleComparison       from './VehicleComparison';
import MaintenanceReminders    from './MaintenanceReminders';
import ReferralCard  from './ReferralCard';
import ReviewWidget  from './ReviewWidget';
import PushNotificationToggle from './PushNotificationToggle';

// ── Tab definitions ──────────────────────────────────────────────────────────

type TabId = 'ai' | 'trip' | 'log' | 'charts' | 'service' | 'share' | 'review';

interface Tab {
  id:            TabId;
  emoji:         string;
  label:         string;
  authRequired:  boolean;
  planRequired?: 'pro' | 'fleet';
}

const TABS: Tab[] = [
  { id: 'ai',      emoji: '🤖', label: 'AI',      authRequired: false, planRequired: 'pro'  },
  { id: 'trip',    emoji: '🗺️', label: 'Trip',    authRequired: false, planRequired: undefined },
  { id: 'log',     emoji: '⛽', label: 'Log',     authRequired: true,  planRequired: undefined },
  { id: 'charts',  emoji: '📊', label: 'Charts',  authRequired: true,  planRequired: 'pro'  },
  { id: 'service', emoji: '🔧', label: 'Service', authRequired: true,  planRequired: 'pro'  },
  { id: 'share',   emoji: '🔗', label: 'Share',   authRequired: true,  planRequired: undefined },
  { id: 'review',  emoji: '⭐', label: 'Review',  authRequired: true,  planRequired: undefined },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function ToolsPanel() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<TabId>('ai');

  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro    = userPlan === 'pro' || userPlan === 'fleet';

  // If session drops, fall back to an accessible tab
  const effectiveTab =
    TABS.find((t) => t.id === activeTab)?.authRequired && !session
      ? 'ai'
      : activeTab;

  return (
    <div className="mt-4">
      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-base">⚡</span>
        <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">
          Tools &amp; Insights
        </h2>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* ── Tab bar — horizontally scrollable on small screens ──────────── */}
      <div className="overflow-x-auto -mx-0.5 px-0.5 pb-0.5 mb-4">
        <div
          className="flex gap-1.5 bg-slate-100 rounded-2xl p-1.5"
          style={{ minWidth: 'max-content' }}
          role="tablist"
        >
          {TABS.map((tab) => {
            const isActive         = effectiveTab === tab.id;
            const requiresUpgrade  = !!tab.planRequired && !isPro && !!session;
            const isDisabled       = tab.authRequired && !session;

            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                disabled={isDisabled}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex flex-col items-center gap-0.5 py-2.5 px-4 rounded-xl',
                  'text-[11px] font-bold transition-all duration-200 select-none',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                  isActive
                    ? 'bg-white shadow-sm text-amber-600'
                    : isDisabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : requiresUpgrade
                        ? 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-white/60',
                ].join(' ')}
                title={isDisabled ? 'Sign in to access this feature' : undefined}
              >
                <span className={`text-base leading-none transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                  {tab.emoji}
                </span>
                <span className="leading-none mt-0.5 whitespace-nowrap">{tab.label}</span>
                {tab.planRequired && !isPro && (
                  <span className="text-[8px] bg-amber-400 text-white px-1 rounded-full leading-none">PRO</span>
                )}
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-amber-500 mt-0.5" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab panels ──────────────────────────────────────────────────── */}

      {/* AI Advisor */}
      <div role="tabpanel" id="tabpanel-ai" hidden={effectiveTab !== 'ai'}>
        {effectiveTab === 'ai' && !session && <AiAdvisor embedded />}
        {effectiveTab === 'ai' && session && isPro && <AiAdvisor embedded />}
        {effectiveTab === 'ai' && session && !isPro && <UpgradePrompt feature="AI Advisor" />}
      </div>

      {/* Trip Cost Estimator */}
      <div role="tabpanel" id="tabpanel-trip" hidden={effectiveTab !== 'trip'}>
        {effectiveTab === 'trip' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <TripCostEstimator embedded />
          </div>
        )}
      </div>

      {/* Fillup Log + Budget */}
      <div role="tabpanel" id="tabpanel-log" hidden={effectiveTab !== 'log'}>
        {effectiveTab === 'log' && session && (
          <div className="space-y-3">
            <MonthlyBudgetGoal />
            <FillupHistory />
          </div>
        )}
        {effectiveTab === 'log' && !session && <SignInPrompt feature="fillup log" />}
      </div>

      {/* Charts */}
      <div role="tabpanel" id="tabpanel-charts" hidden={effectiveTab !== 'charts'}>
        {effectiveTab === 'charts' && session && isPro && (
          <div className="space-y-3">
            <MpgChart />
            <FuelPriceHistory />
            <NationalGasPriceChart />
            <VehicleSpendingBreakdown />
            <VehicleComparison />
          </div>
        )}
        {effectiveTab === 'charts' && session && !isPro && <UpgradePrompt feature="Fuel Charts & Analytics" />}
        {effectiveTab === 'charts' && !session && <SignInPrompt feature="charts" />}
      </div>

      {/* Maintenance / Service */}
      <div role="tabpanel" id="tabpanel-service" hidden={effectiveTab !== 'service'}>
        {effectiveTab === 'service' && session && isPro && <MaintenanceReminders />}
        {effectiveTab === 'service' && session && !isPro && <UpgradePrompt feature="Maintenance Reminders" />}
        {effectiveTab === 'service' && !session && <SignInPrompt feature="maintenance reminders" />}
      </div>

      {/* Referral / Share */}
      <div role="tabpanel" id="tabpanel-share" hidden={effectiveTab !== 'share'}>
        {effectiveTab === 'share' && session && (
          <div className="space-y-3">
            <ReferralCard />
            <PushNotificationToggle />
          </div>
        )}
        {effectiveTab === 'share' && !session && <SignInPrompt feature="referral program" />}
      </div>

      {/* Review */}
      <div role="tabpanel" id="tabpanel-review" hidden={effectiveTab !== 'review'}>
        {effectiveTab === 'review' && session && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <ReviewWidget mode="submit" />
          </div>
        )}
        {effectiveTab === 'review' && !session && <SignInPrompt feature="reviews" />}
      </div>
    </div>
  );
}

// ── Sign-in prompt ────────────────────────────────────────────────────────────

function SignInPrompt({ feature }: { feature: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-8 text-center space-y-2">
      <p className="text-2xl">🔒</p>
      <p className="text-sm font-bold text-slate-700">Sign in to access your {feature}</p>
      <p className="text-xs text-slate-400 leading-relaxed max-w-[240px] mx-auto">
        Create a free account to log fillups, track MPG, set budgets, and see your spending charts.
      </p>
    </div>
  );
}

// ── Upgrade prompt ────────────────────────────────────────────────────────────

function UpgradePrompt({ feature }: { feature: string }) {
  return (
    <div className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm px-6 py-8 text-center space-y-3">
      <p className="text-3xl">⭐</p>
      <p className="text-sm font-black text-slate-700">Pro Feature</p>
      <p className="text-xs text-slate-500 leading-relaxed max-w-[260px] mx-auto">
        <span className="font-semibold text-amber-700">{feature}</span> is available on the{' '}
        <span className="font-semibold">GasCap Pro</span> plan. Upgrade to unlock AI insights,
        charts, maintenance tracking, and more.
      </p>
      <a
        href="/upgrade"
        className="inline-block mt-1 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-black rounded-2xl transition-colors"
      >
        Upgrade to Pro →
      </a>
    </div>
  );
}
