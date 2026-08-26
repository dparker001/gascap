'use client';

/**
 * Phase 5A — Feedback Campaign survey. Mobile-first, one question per
 * screen (progressive, not a single giant form) — target ~2 minutes.
 * Eligibility/"already submitted"/rental-question gating all come from
 * GET /api/feedback/status; this page never decides that itself.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  PRIMARY_FEATURE_OPTIONS, PMF_OPTIONS, RENTAL_HELPFULNESS_OPTIONS,
  type PrimaryFeature, type PmfResponse, type RentalHelpfulness,
} from '@/lib/feedbackCampaignShared';

interface FeedbackStatus {
  campaignKey: string | null;
  eligible: boolean;
  alreadySubmitted: boolean;
  hasRentalUsage: boolean;
  campaignEndsAt: string | null;
}

interface FormState {
  overallSatisfaction: number | null;
  primaryFeature: PrimaryFeature | null;
  likes: string;
  frustrations: string;
  hadIssue: boolean | null;
  issueDescription: string;
  improvementRequest: string;
  featureRequest: string;
  pmfResponse: PmfResponse | null;
  rentalEaseScore: number | null;
  rentalHelpfulness: RentalHelpfulness | null;
  rentalImprovement: string;
}

const EMPTY_FORM: FormState = {
  overallSatisfaction: null, primaryFeature: null, likes: '', frustrations: '',
  hadIssue: null, issueDescription: '', improvementRequest: '', featureRequest: '',
  pmfResponse: null, rentalEaseScore: null, rentalHelpfulness: null, rentalImprovement: '',
};

function ScaleButtons({ value, onChange, max = 5 }: { value: number | null; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`w-12 h-12 rounded-xl font-black text-lg border-2 transition-colors ${
            value === n ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function OptionList<T extends string>({ options, labels, value, onChange }: {
  options: readonly T[]; labels: Record<T, string>; value: T | null; onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`w-full text-left px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-colors ${
            value === opt ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const { t } = useTranslation();

  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const startedRef = useState(() => ({ fired: false }))[0];

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.replace('/signin?next=/feedback');
  }, [sessionStatus, router]);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/feedback/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FeedbackStatus | null) => setStatus(data))
      .catch(() => setStatus(null));
  }, [session]);

  useEffect(() => {
    if (!status?.eligible || startedRef.fired) return;
    startedRef.fired = true;
    fetch('/api/feedback/interaction', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'started' }),
    }).catch(() => {});
  }, [status, startedRef]);

  const coreSteps = 8;
  const totalSteps = coreSteps + (status?.hasRentalUsage ? 3 : 0);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return form.overallSatisfaction != null;
      case 1: return form.primaryFeature != null;
      case 2: return form.likes.trim().length > 0;
      case 3: return form.frustrations.trim().length > 0;
      case 4: return form.hadIssue === false || (form.hadIssue === true && form.issueDescription.trim().length > 0);
      case 5: return form.improvementRequest.trim().length > 0;
      case 6: return form.featureRequest.trim().length > 0;
      case 7: return form.pmfResponse != null;
      case 8: return form.rentalEaseScore != null;
      case 9: return form.rentalHelpfulness != null;
      case 10: return true; // rentalImprovement optional
      default: return false;
    }
  }, [step, form]);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overallSatisfaction: form.overallSatisfaction,
          primaryFeature: form.primaryFeature,
          likes: form.likes,
          frustrations: form.frustrations,
          hadIssue: form.hadIssue,
          issueDescription: form.hadIssue ? form.issueDescription : null,
          improvementRequest: form.improvementRequest,
          featureRequest: form.featureRequest,
          pmfResponse: form.pmfResponse,
          rentalEaseScore: status?.hasRentalUsage ? form.rentalEaseScore : null,
          rentalHelpfulness: status?.hasRentalUsage ? form.rentalHelpfulness : null,
          rentalImprovement: status?.hasRentalUsage ? form.rentalImprovement : null,
        }),
      });
      if (!res.ok) throw new Error('submit failed');
      setSubmitted(true);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionStatus === 'loading' || (session?.user && status === null)) {
    return <div className="min-h-screen bg-[#eef1f7]" />;
  }

  if (session?.user && status && (!status.eligible && !status.alreadySubmitted && !submitted)) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center px-4">
        <p className="text-slate-500 text-sm text-center">Feedback isn't available for your account right now.</p>
      </div>
    );
  }

  if (submitted || status?.alreadySubmitted) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-card p-6 max-w-sm w-full text-center space-y-3">
          <p className="text-3xl" aria-hidden="true">🎉</p>
          <p className="text-navy-800 font-black text-lg">{t.feedbackCampaign.thankYouTitle}</p>
          <p className="text-sm text-slate-600 leading-relaxed">{t.feedbackCampaign.thankYouBody}</p>
          <p className="text-xs text-slate-400 leading-relaxed">{t.feedbackCampaign.thankYouNotMonthly}</p>
          <button
            onClick={() => router.push('/')}
            className="w-full mt-2 py-3 rounded-2xl bg-navy-700 hover:bg-navy-800 text-white font-black text-sm"
          >
            {t.feedbackCampaign.thankYouDone}
          </button>
        </div>
      </div>
    );
  }

  const isRentalStep = step >= coreSteps;

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">
      <div className="px-4 pt-6 pb-2 max-w-lg mx-auto w-full">
        <p className="text-[11px] font-bold text-slate-400 text-center">
          {t.feedbackCampaign.stepOf(step + 1, totalSteps)}
        </p>
        <div className="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 px-4 max-w-lg mx-auto w-full flex flex-col justify-center pb-24">
        <div className="bg-white rounded-3xl shadow-card p-5 space-y-4">
          {step === 0 && (
            <>
              <p className="font-black text-navy-800 text-center">{t.feedbackCampaign.q1}</p>
              <ScaleButtons value={form.overallSatisfaction} onChange={(n) => setForm((f) => ({ ...f, overallSatisfaction: n }))} />
            </>
          )}
          {step === 1 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q2}</p>
              <OptionList
                options={PRIMARY_FEATURE_OPTIONS}
                labels={t.feedbackCampaign.q2Options}
                value={form.primaryFeature}
                onChange={(v) => setForm((f) => ({ ...f, primaryFeature: v }))}
              />
            </>
          )}
          {step === 2 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q3}</p>
              <textarea
                value={form.likes}
                onChange={(e) => setForm((f) => ({ ...f, likes: e.target.value }))}
                className="input-field min-h-[100px]"
                rows={4}
              />
            </>
          )}
          {step === 3 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q4}</p>
              <textarea
                value={form.frustrations}
                onChange={(e) => setForm((f) => ({ ...f, frustrations: e.target.value }))}
                className="input-field min-h-[100px]"
                rows={4}
              />
            </>
          )}
          {step === 4 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q5}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm((f) => ({ ...f, hadIssue: true }))}
                  className={`flex-1 py-3 rounded-xl border-2 font-bold ${form.hadIssue === true ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >{t.feedbackCampaign.yes}</button>
                <button
                  onClick={() => setForm((f) => ({ ...f, hadIssue: false, issueDescription: '' }))}
                  className={`flex-1 py-3 rounded-xl border-2 font-bold ${form.hadIssue === false ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >{t.feedbackCampaign.no}</button>
              </div>
              {form.hadIssue === true && (
                <textarea
                  value={form.issueDescription}
                  onChange={(e) => setForm((f) => ({ ...f, issueDescription: e.target.value }))}
                  placeholder={t.feedbackCampaign.q5Describe}
                  className="input-field min-h-[80px]"
                  rows={3}
                />
              )}
            </>
          )}
          {step === 5 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q6}</p>
              <textarea
                value={form.improvementRequest}
                onChange={(e) => setForm((f) => ({ ...f, improvementRequest: e.target.value }))}
                className="input-field min-h-[100px]"
                rows={4}
              />
            </>
          )}
          {step === 6 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q7}</p>
              <textarea
                value={form.featureRequest}
                onChange={(e) => setForm((f) => ({ ...f, featureRequest: e.target.value }))}
                className="input-field min-h-[100px]"
                rows={4}
              />
            </>
          )}
          {step === 7 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.q8}</p>
              <OptionList
                options={PMF_OPTIONS}
                labels={t.feedbackCampaign.q8Options}
                value={form.pmfResponse}
                onChange={(v) => setForm((f) => ({ ...f, pmfResponse: v }))}
              />
            </>
          )}
          {isRentalStep && step === coreSteps && (
            <>
              <p className="text-[11px] font-bold text-navy-500 uppercase tracking-wide">{t.feedbackCampaign.rentalHeading}</p>
              <p className="font-black text-navy-800 text-center">{t.feedbackCampaign.rentalQ1}</p>
              <ScaleButtons value={form.rentalEaseScore} onChange={(n) => setForm((f) => ({ ...f, rentalEaseScore: n }))} />
            </>
          )}
          {isRentalStep && step === coreSteps + 1 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.rentalQ2}</p>
              <OptionList
                options={RENTAL_HELPFULNESS_OPTIONS}
                labels={t.feedbackCampaign.rentalQ2Options}
                value={form.rentalHelpfulness}
                onChange={(v) => setForm((f) => ({ ...f, rentalHelpfulness: v }))}
              />
            </>
          )}
          {isRentalStep && step === coreSteps + 2 && (
            <>
              <p className="font-black text-navy-800">{t.feedbackCampaign.rentalQ3}</p>
              <textarea
                value={form.rentalImprovement}
                onChange={(e) => setForm((f) => ({ ...f, rentalImprovement: e.target.value }))}
                className="input-field min-h-[100px]"
                rows={4}
              />
            </>
          )}

          {submitError && <p className="text-xs text-red-500 text-center">{t.feedbackCampaign.submitError}</p>}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 p-4">
        <div className="max-w-lg mx-auto flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm"
            >
              {t.feedbackCampaign.back}
            </button>
          )}
          {step < totalSteps - 1 ? (
            <button
              disabled={!canAdvance}
              onClick={() => setStep((s) => s + 1)}
              className="flex-1 py-3.5 rounded-2xl bg-navy-700 hover:bg-navy-800 disabled:opacity-40 text-white font-black text-sm"
            >
              {t.feedbackCampaign.next}
            </button>
          ) : (
            <button
              disabled={!canAdvance || submitting}
              onClick={handleSubmit}
              className="flex-1 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-black text-sm"
            >
              {submitting ? t.feedbackCampaign.submitting : t.feedbackCampaign.submit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
