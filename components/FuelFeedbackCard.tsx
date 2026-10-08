'use client';

/**
 * Phase 1 P1-B — post-save fuel feedback card. Renders the model from
 * lib/fuelFeedback.ts: how the saved fill-up compares with the same-grade EIA
 * weekly average, or an explicit "not enough data yet" with the reason, plus
 * one honest next step. No prediction, no BUY/WAIT language, no estimates.
 * Fires `fillup_feedback_viewed` once per mount (client, advisory).
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { trackClientEvent } from '@/lib/clientAnalytics';
import type { FuelFeedback } from '@/lib/fuelFeedback';

export default function FuelFeedbackCard({ feedback }: { feedback: FuelFeedback }) {
  const { t } = useTranslation();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackClientEvent('fillup_feedback_viewed', {
      outcome: feedback.outcome,
      ...(feedback.reason ? { reason: feedback.reason } : {}),
    });
  }, [feedback.outcome, feedback.reason]);

  const f = t.fillup;
  const gradeLabel =
    feedback.grade === 'regular'  ? f.gradeRegular  :
    feedback.grade === 'midgrade' ? f.gradeMidGrade :
    feedback.grade === 'premium'  ? f.gradePremium  :
    feedback.grade === 'diesel'   ? f.gradeDiesel   : '';
  const kind =
    feedback.areaKind === 'state'    ? f.feedbackAreaState :
    feedback.areaKind === 'regional' ? f.feedbackAreaRegional : f.feedbackAreaNational;

  const nextText = feedback.nextStep === 'log_next' ? f.feedbackNextLog : f.feedbackNextOdometer;

  if (feedback.outcome === 'priced' && feedback.baselinePeriod && feedback.baselinePrice !== undefined && feedback.paidPerGallon !== undefined) {
    const amt  = (feedback.amount ?? 0).toFixed(2);
    const week = new Date(`${feedback.baselinePeriod}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const below = feedback.direction === 'below';
    const same  = feedback.direction === 'same';
    return (
      <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 text-left space-y-1.5" data-testid="fuel-feedback">
        <p className={`text-[13px] font-black ${same ? 'text-slate-700' : below ? 'text-emerald-700' : 'text-amber-700'}`}>
          {same ? f.feedbackSame(kind) : below ? f.feedbackBelow(amt, kind) : f.feedbackAbove(amt, kind)}
        </p>
        <p className="text-[11px] text-slate-600">
          {f.feedbackDetail(feedback.paidPerGallon.toFixed(3), feedback.baselinePrice.toFixed(3), gradeLabel, week)}
        </p>
        <p className="text-[11px] text-slate-500">{nextText}</p>
        <p className="text-[10px] text-slate-400">{f.feedbackSource}</p>
      </div>
    );
  }

  const reasonText =
    feedback.reason === 'no_grade'          ? f.feedbackReasonNoGrade :
    feedback.reason === 'unsupported_grade' ? f.feedbackReasonUnsupported :
    feedback.reason === 'invalid'           ? f.feedbackReasonInvalid : f.feedbackReasonNoBaseline;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 text-left space-y-1.5" data-testid="fuel-feedback">
      <p className="text-[13px] font-black text-slate-700">{f.feedbackInsufficientTitle}</p>
      <p className="text-[11px] text-slate-600">{reasonText}</p>
      <p className="text-[11px] text-slate-500">{nextText}</p>
    </div>
  );
}
