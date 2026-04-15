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
import ReferralCard           from './ReferralCard';
import ReviewWidget           from './ReviewWidget';
import StationComparison      from './StationComparison';
import MonthlyReportCard      from './MonthlyReportCard';
import SavingsDashboard       from './SavingsDashboard';
import WorstFillup            from './WorstFillup';
import GasPricePrediction     from './GasPricePrediction';
import ReferralLeaderboard    from './ReferralLeaderboard';
import VehicleHealthAlert     from './VehicleHealthAlert';
import StreakRewards          from './StreakRewards';
import ManualFillupLogger     from './ManualFillupLogger';
import { useTranslation }    from '@/contexts/LanguageContext';
// ── Tab definitions ──────────────────────────────────────────────────────────

type TabId = 'ai' | 'trip' | 'compare' | 'log' | 'charts' | 'stats' | 'service' | 'share' | 'review';

interface Tab {
  id:            TabId;
  emoji:         string;
  label:         string;
  authRequired:  boolean;
  planRequired?: 'pro' | 'fleet';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ToolsPanel() {
  const { data: session } = useSession();
  const { t }             = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('ai');

  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro    = userPlan === 'pro' || userPlan === 'fleet';

  const TABS: Tab[] = [
    { id: 'ai',      emoji: '🤖', label: t.tools.tabs.ai,      authRequired: false, planRequired: undefined },
    { id: 'trip',    emoji: '🗺️', label: t.tools.tabs.trip,    authRequired: false, planRequired: undefined },
    { id: 'compare', emoji: '🏪', label: t.tools.tabs.compare, authRequired: false, planRequired: undefined },
    { id: 'log',     emoji: '⛽', label: t.tools.tabs.log,     authRequired: true,  planRequired: undefined },
    { id: 'charts',  emoji: '📊', label: t.tools.tabs.charts,  authRequired: true,  planRequired: 'pro'  },
    { id: 'stats',   emoji: '📈', label: t.tools.tabs.stats,   authRequired: true,  planRequired: undefined },
    { id: 'service', emoji: '🔧', label: t.tools.tabs.service, authRequired: true,  planRequired: 'pro'  },
    { id: 'share',   emoji: '🔗', label: t.tools.tabs.share,   authRequired: true,  planRequired: undefined },
    { id: 'review',  emoji: '⭐', label: t.tools.tabs.review,  authRequired: true,  planRequired: undefined },
  ];

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
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-100 uppercase tracking-wider">
          {t.tools.heading}
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* ── Tab grid — 2 rows × 5 columns, all tabs always visible ─────── */}
      <div className="mb-4">
        <div
          className="grid grid-cols-5 gap-1 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1.5"
          role="tablist"
        >
          {TABS.map((tab) => {
            const isActive        = effectiveTab === tab.id;
            const isDisabled      = tab.authRequired && !session;

            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                disabled={isDisabled}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex flex-col items-center gap-0.5 py-2 px-0.5 rounded-xl w-full',
                  'text-[9px] font-bold transition-all duration-200 select-none',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                  isActive
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-amber-600'
                    : isDisabled
                      ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/60',
                ].join(' ')}
                title={isDisabled ? t.tools.signInHint : undefined}
              >
                <span className={`text-[15px] leading-none transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                  {tab.emoji}
                </span>
                <span className="leading-none mt-0.5 whitespace-nowrap">{tab.label}</span>
                {tab.planRequired && !isPro && (
                  <span className="text-[7px] bg-amber-400 text-white px-1 rounded-full leading-none mt-0.5">PRO</span>
                )}
                {tab.authRequired && !tab.planRequired && !session && (
                  <span className="text-[7px] bg-emerald-500 text-white px-1 rounded-full leading-none mt-0.5">FREE</span>
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

      {/* AI Advisor — available to all; Pro/Fleet unlocks open-ended input */}
      <div role="tabpanel" id="tabpanel-ai" hidden={effectiveTab !== 'ai'}>
        {effectiveTab === 'ai' && <AiAdvisor embedded />}
      </div>

      {/* Trip Cost Estimator */}
      <div role="tabpanel" id="tabpanel-trip" hidden={effectiveTab !== 'trip'}>
        {effectiveTab === 'trip' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <TripCostEstimator embedded />
          </div>
        )}
      </div>

      {/* Station Comparison */}
      <div role="tabpanel" id="tabpanel-compare" hidden={effectiveTab !== 'compare'}>
        {effectiveTab === 'compare' && <StationComparison embedded />}
      </div>

      {/* Fillup Log + Budget */}
      <div role="tabpanel" id="tabpanel-log" hidden={effectiveTab !== 'log'}>
        {effectiveTab === 'log' && session && (
          <div className="space-y-3">
            <ManualFillupLogger />
            <MonthlyBudgetGoal />
            <FillupHistory />
          </div>
        )}
        {effectiveTab === 'log' && !session && <SignInPrompt feature={t.toolsPrompts.featureFillUpLog} />}
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
        {effectiveTab === 'charts' && session && !isPro && <UpgradePrompt feature={t.toolsPrompts.chartsLabel} />}
        {effectiveTab === 'charts' && !session && <SignInPrompt feature={t.toolsPrompts.featureCharts} />}
      </div>

      {/* Stats */}
      <div role="tabpanel" id="tabpanel-stats" hidden={effectiveTab !== 'stats'}>
        {effectiveTab === 'stats' && session && (
          <div className="space-y-3">
            <VehicleHealthAlert />
            <MonthlyReportCard />
            <SavingsDashboard />
            <WorstFillup />
            <GasPricePrediction />
          </div>
        )}
        {effectiveTab === 'stats' && !session && <SignInPrompt feature={t.toolsPrompts.featureStats} />}
      </div>

      {/* Maintenance / Service */}
      <div role="tabpanel" id="tabpanel-service" hidden={effectiveTab !== 'service'}>
        {effectiveTab === 'service' && session && isPro && <MaintenanceReminders />}
        {effectiveTab === 'service' && session && !isPro && <UpgradePrompt feature={t.toolsPrompts.maintenanceLabel} />}
        {effectiveTab === 'service' && !session && <SignInPrompt feature={t.toolsPrompts.featureMaintenance} />}
      </div>

      {/* Referral / Share */}
      <div role="tabpanel" id="tabpanel-share" hidden={effectiveTab !== 'share'}>
        {effectiveTab === 'share' && session && (
          <div className="space-y-3">
            <StreakRewards />
            <ReferralLeaderboard />
            <ReferralCard />
          </div>
        )}
        {effectiveTab === 'share' && !session && <SignInPrompt feature={t.toolsPrompts.featureReferral} />}
      </div>

      {/* Review */}
      <div role="tabpanel" id="tabpanel-review" hidden={effectiveTab !== 'review'}>
        {effectiveTab === 'review' && session && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <ReviewWidget mode="submit" />
          </div>
        )}
        {effectiveTab === 'review' && !session && <SignInPrompt feature={t.toolsPrompts.featureReviews} />}
      </div>

    </div>
  );
}

// ── Sign-in prompt ────────────────────────────────────────────────────────────

function SignInPrompt({ feature }: { feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-8 text-center space-y-2">
      <p className="text-2xl">🔒</p>
      <p className="text-sm font-bold text-slate-700">{t.toolsPrompts.signInTo} {feature}</p>
      <p className="text-xs text-slate-400 leading-relaxed max-w-[240px] mx-auto">
        {t.toolsPrompts.signInBody}
      </p>
    </div>
  );
}

// ── Upgrade prompt ────────────────────────────────────────────────────────────

function UpgradePrompt({ feature }: { feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm px-6 py-8 text-center space-y-3">
      <p className="text-3xl">⭐</p>
      <p className="text-sm font-black text-slate-700">{t.toolsPrompts.proFeature}</p>
      <p className="text-xs text-slate-500 leading-relaxed max-w-[260px] mx-auto">
        <span className="font-semibold text-amber-700">{feature}</span> {t.toolsPrompts.proBody1}{' '}
        <span className="font-semibold">GasCap™ Pro</span> {t.toolsPrompts.proBody2}
      </p>
      <a
        href="/upgrade"
        className="inline-block mt-1 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-black rounded-2xl transition-colors"
      >
        {t.toolsPrompts.upgradeToPro}
      </a>
    </div>
  );
}
