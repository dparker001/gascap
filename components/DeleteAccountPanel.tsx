'use client';

/**
 * Self-service account deletion panel (App Store 5.1.1). A signed-in user can
 * permanently delete their own account + data directly here — no email request.
 * Requires typing DELETE to confirm; on success the user is signed out.
 */

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';

export default function DeleteAccountPanel() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const d = t.settings;
  const [confirm,  setConfirm]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState('');

  // "DELETE" is the language-neutral confirmation keyword.
  const canDelete = confirm.trim().toUpperCase() === 'DELETE' && !busy;

  async function handleDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? d.delErrorGeneric);
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError(d.delErrorNetwork);
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return <div className="h-28 rounded-2xl bg-white/60 animate-pulse" />;
  }

  // Signed out — must sign in to delete (so we delete the right account).
  if (!session) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-black text-navy-700 mb-1">{d.delSignedOutHeading}</h2>
        <p className="text-sm text-slate-500 mb-4">{d.delSignedOutBody}</p>
        <Link
          href="/signin?next=/delete-account"
          className="inline-block py-3 px-5 rounded-2xl font-black text-sm text-white
                     bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95 transition-opacity"
        >
          {d.delSignInBtn}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-6 text-center">
        <p className="text-3xl mb-2" aria-hidden="true">✅</p>
        <h2 className="text-lg font-black text-navy-700 mb-1">{d.delDoneHeading}</h2>
        <p className="text-sm text-slate-500 mb-4">{d.delDoneBody}</p>
        <button
          onClick={() => signOut({ callbackUrl: '/?deleted=1' })}
          className="inline-block py-3 px-6 rounded-2xl font-black text-sm text-white
                     bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95 transition-opacity"
        >
          {d.delDoneBtn}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-red-200 shadow-sm p-6">
      <h2 className="text-lg font-black text-red-600 mb-1">{d.delHeading}</h2>
      <p className="text-sm text-slate-600 mb-1">
        {d.delSignedInAs} <span className="font-semibold text-slate-800">{session.user?.email}</span>
      </p>
      <p className="text-sm text-slate-500 mb-4">{d.delWarning}</p>

      <label className="block text-xs font-bold text-slate-500 mb-1">{d.delTypeConfirm}</label>
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="DELETE"
        autoCapitalize="characters"
        autoCorrect="off"
        className="w-full rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold
                   text-slate-800 focus:border-red-400 focus:outline-none mb-3"
      />

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      <button
        onClick={handleDelete}
        disabled={!canDelete}
        className="w-full py-3 rounded-2xl font-black text-sm text-white transition-colors
                   bg-red-600 hover:bg-red-500 disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        {busy ? d.delDeleting : d.delButton}
      </button>
    </div>
  );
}
