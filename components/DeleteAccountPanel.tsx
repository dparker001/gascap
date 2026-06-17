'use client';

/**
 * Self-service account deletion panel (App Store 5.1.1). A signed-in user can
 * permanently delete their own account + data directly here — no email request.
 * Requires typing DELETE to confirm; on success the user is signed out.
 */

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export default function DeleteAccountPanel() {
  const { data: session, status } = useSession();
  const [confirm,  setConfirm]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState('');

  const canDelete = confirm.trim().toUpperCase() === 'DELETE' && !busy;

  async function handleDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Something went wrong. Please try again.');
        setBusy(false);
        return;
      }
      setDone(true);
      // Manual dismissal only — the confirmation stays until the user taps Done.
    } catch {
      setError('Network error — please try again.');
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
        <h2 className="text-lg font-black text-navy-700 mb-1">Delete your account</h2>
        <p className="text-sm text-slate-500 mb-4">
          Sign in first so we can permanently delete the correct account.
        </p>
        <Link
          href="/signin?next=/delete-account"
          className="inline-block py-3 px-5 rounded-2xl font-black text-sm text-white
                     bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95 transition-opacity"
        >
          Sign in to delete my account
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-6 text-center">
        <p className="text-3xl mb-2" aria-hidden="true">✅</p>
        <h2 className="text-lg font-black text-navy-700 mb-1">Your account has been deleted</h2>
        <p className="text-sm text-slate-500 mb-4">
          Your GasCap™ account and all associated data have been permanently removed.
          A confirmation email is on its way.
        </p>
        <button
          onClick={() => signOut({ callbackUrl: '/?deleted=1' })}
          className="inline-block py-3 px-6 rounded-2xl font-black text-sm text-white
                     bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95 transition-opacity"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-red-200 shadow-sm p-6">
      <h2 className="text-lg font-black text-red-600 mb-1">Permanently delete your account</h2>
      <p className="text-sm text-slate-600 mb-1">
        Signed in as <span className="font-semibold text-slate-800">{session.user?.email}</span>.
      </p>
      <p className="text-sm text-slate-500 mb-4">
        This <strong>permanently</strong> deletes your account and all associated data
        (vehicles, fill-up history, preferences, referral &amp; giveaway data). This cannot be undone.
      </p>

      <label className="block text-xs font-bold text-slate-500 mb-1">
        Type <span className="font-black text-red-600">DELETE</span> to confirm
      </label>
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
        {busy ? 'Deleting…' : 'Permanently delete my account'}
      </button>
    </div>
  );
}
