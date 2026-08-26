'use client';

/**
 * Phase 5A — Feedback Campaign invitation card. Purely a renderer for
 * server-authoritative state from GET /api/feedback/status; this component
 * never computes eligibility or "already submitted" itself. Local state
 * here (`dismissed`) is session-only UI behavior, not authoritative — the
 * server still shows the invite again on a future visit even if dismissed
 * this session, matching CLAUDE.md's "client-side gating is never
 * sufficient" rule extended to invitation display, not just paid gating.
 */

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';

interface FeedbackStatus {
  campaignKey: string | null;
  eligible: boolean;
  alreadySubmitted: boolean;
  campaignEndsAt: string | null;
}

export default function FeedbackInvitation() {
  const { data: session } = useSession();
  const { t, locale } = useTranslation();
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/feedback/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FeedbackStatus | null) => setStatus(data))
      .catch(() => { /* invitation just won't show this load — non-critical */ });
  }, [session]);

  const show = !!status?.eligible && !status.alreadySubmitted && !dismissed;

  useEffect(() => {
    if (!show || shownRef.current) return;
    shownRef.current = true;
    fetch('/api/feedback/interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invite_shown' }),
    }).catch(() => {});
  }, [show]);

  if (!show) return null;

  const deadline = status?.campaignEndsAt
    ? new Date(status.campaignEndsAt).toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="px-4 lg:px-0 pt-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="rounded-2xl border border-navy-100 bg-gradient-to-br from-navy-50 to-white shadow-sm p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-navy-500">
          {t.feedbackCampaign.inviteEyebrow}
        </p>
        <p className="text-navy-700 text-sm leading-snug mt-1">
          {t.feedbackCampaign.inviteBody}
        </p>
        <div className="mt-2.5 bg-white border border-slate-100 rounded-xl px-3 py-2.5">
          <p className="text-xs text-slate-600 leading-snug">
            {deadline ? t.feedbackCampaign.inviteDeadline(deadline) : t.feedbackCampaign.inviteDrawing}
          </p>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setDismissed(true)}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm"
          >
            {t.feedbackCampaign.inviteDismiss}
          </button>
          <Link
            href="/feedback"
            onClick={() => {
              fetch('/api/feedback/interaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'opened' }),
              }).catch(() => {});
            }}
            className="flex-1 py-2.5 rounded-xl bg-navy-700 hover:bg-navy-800 text-white text-center font-black text-sm transition-colors"
          >
            {t.feedbackCampaign.inviteCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
