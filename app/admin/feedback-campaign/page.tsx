'use client';

import { useEffect, useState } from 'react';

const ADMIN_PW_KEY = 'admin_password';

interface FeedbackAdminData {
  campaign: {
    key: string; name: string; startsAt: string; endsAt: string | null;
    drawingAt: string | null; timezone: string; drawingStatus: string;
  } | null;
  funnel: {
    eligible: number; inviteShown: number; started: number; submitted: number;
    completionRate: number | null; drawingEntries: number;
  };
  /** kind -> state -> count, scoped to this campaign — see CampaignCommunication. */
  communications: Record<string, Record<string, number>>;
  avgSatisfaction: number | null;
  featureBreakdown: Record<string, number>;
  pmfBreakdown: Record<string, number>;
  issueCount: number;
  rentalResponseCount: number;
  avgRentalEase: number | null;
  responses: Array<{
    id: string; submittedAt: string; overallSatisfaction: number; primaryFeature: string;
    likes: string; frustrations: string; hadIssue: boolean; issueDescription: string | null;
    improvementRequest: string; featureRequest: string; pmfResponse: string;
    rentalEaseScore: number | null; rentalHelpfulness: string | null; rentalImprovement: string | null;
    platform: string | null;
  }>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-navy-800 mt-0.5">{value}</p>
    </div>
  );
}

export default function AdminFeedbackCampaignPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<FeedbackAdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_PW_KEY);
    if (saved) { setPassword(saved); fetchData(saved); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData(pw: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/feedback-campaign', { headers: { 'x-admin-password': pw } });
      if (res.status === 401) { setError('Wrong password'); setAuthed(false); return; }
      if (!res.ok) { setError('Server error'); return; }
      setData(await res.json());
      setAuthed(true);
      sessionStorage.setItem(ADMIN_PW_KEY, pw);
    } finally {
      setLoading(false);
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center px-4">
        <form
          onSubmit={(e) => { e.preventDefault(); fetchData(password); }}
          className="bg-white rounded-2xl shadow-card p-6 max-w-sm w-full space-y-3"
        >
          <p className="font-black text-navy-800">Admin — Feedback Campaign</p>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password" className="input-field"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-3 rounded-xl bg-navy-700 text-white font-bold text-sm">
            {loading ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  if (!data?.campaign) {
    return <div className="min-h-screen bg-[#eef1f7] p-6"><p className="text-slate-500 text-sm">No feedback campaign found.</p></div>;
  }

  const { campaign, funnel } = data;

  return (
    <div className="min-h-screen bg-[#eef1f7] p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <p className="text-xl font-black text-navy-800">{campaign.name}</p>
        <p className="text-xs text-slate-500 mt-1">
          {campaign.key} · {campaign.drawingStatus} · {new Date(campaign.startsAt).toLocaleDateString()}
          {campaign.endsAt ? ` – ${new Date(campaign.endsAt).toLocaleDateString()}` : ' (open-ended)'}
          {campaign.drawingAt ? ` · drawing ~${new Date(campaign.drawingAt).toLocaleDateString()}` : ''}
          {' · '}{campaign.timezone}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Eligible" value={funnel.eligible} />
        <StatCard label="Invites Shown (in-app)" value={funnel.inviteShown} />
        <StatCard label="Started" value={funnel.started} />
        <StatCard label="Submitted" value={funnel.submitted} />
        <StatCard label="Completion Rate" value={funnel.completionRate != null ? `${Math.round(funnel.completionRate * 100)}%` : '—'} />
        <StatCard label="Drawing Entries" value={funnel.drawingEntries} />
        <StatCard label="Avg Satisfaction" value={data.avgSatisfaction != null ? data.avgSatisfaction.toFixed(1) : '—'} />
        <StatCard label="Reported Issues" value={data.issueCount} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <p className="font-black text-navy-800 text-sm mb-1">Communications (this campaign only)</p>
        <p className="text-[10px] text-slate-400 mb-3">
          Only "sent" means the provider confirmed acceptance. "claimed"/"ambiguous" rows are stuck or uncertain and are never auto-retried.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['invite_email', 'reminder_email', 'reminder_push'] as const).map((kind) => (
            <div key={kind} className="border border-slate-100 rounded-xl p-3">
              <p className="text-xs font-bold text-navy-700 mb-1.5">
                {kind === 'invite_email' ? 'Invite Email' : kind === 'reminder_email' ? 'Reminder Email' : 'Reminder Push'}
              </p>
              {Object.entries(data.communications[kind] ?? {}).length === 0 && (
                <p className="text-[11px] text-slate-400">No attempts yet</p>
              )}
              {Object.entries(data.communications[kind] ?? {}).map(([state, count]) => (
                <div key={state} className="flex justify-between text-xs py-0.5">
                  <span className={state === 'sent' ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>{state}</span>
                  <span className="font-bold">{count}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <p className="font-black text-navy-800 text-sm mb-2">Feature Used Most</p>
        {Object.entries(data.featureBreakdown).map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-slate-600">{k}</span><span className="font-bold">{v}</span></div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <p className="font-black text-navy-800 text-sm mb-2">PMF Distribution</p>
        {Object.entries(data.pmfBreakdown).map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-slate-600">{k}</span><span className="font-bold">{v}</span></div>
        ))}
      </div>

      {data.rentalResponseCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="font-black text-navy-800 text-sm mb-2">Rental Return Feedback</p>
          <p className="text-sm text-slate-600">{data.rentalResponseCount} rental users responded — avg ease {data.avgRentalEase?.toFixed(1) ?? '—'}/5</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <p className="font-black text-navy-800 text-sm mb-3">Responses ({data.responses.length})</p>
        <div className="space-y-2">
          {data.responses.map((r) => (
            <div key={r.id} className="border border-slate-100 rounded-xl p-3">
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full flex justify-between items-center text-left"
              >
                <span className="text-sm font-semibold text-navy-700">
                  {r.overallSatisfaction}/5 · {r.primaryFeature} {r.hadIssue && '· ⚠️ issue'}
                </span>
                <span className="text-xs text-slate-400">{new Date(r.submittedAt).toLocaleDateString()}</span>
              </button>
              {expanded === r.id && (
                <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                  <p><strong>Likes:</strong> {r.likes}</p>
                  <p><strong>Frustrations:</strong> {r.frustrations}</p>
                  {r.hadIssue && <p><strong>Issue:</strong> {r.issueDescription}</p>}
                  <p><strong>Improve:</strong> {r.improvementRequest}</p>
                  <p><strong>Requested feature:</strong> {r.featureRequest}</p>
                  <p><strong>PMF:</strong> {r.pmfResponse}</p>
                  {r.rentalEaseScore != null && <p><strong>Rental ease:</strong> {r.rentalEaseScore}/5 · {r.rentalHelpfulness} · {r.rentalImprovement}</p>}
                  <p className="text-slate-400">{r.platform}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
