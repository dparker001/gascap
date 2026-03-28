'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function VerifyEmailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token  = params.get('token') ?? '';

  useEffect(() => {
    if (!token) { router.replace('/?verified=invalid'); return; }
    // The actual verification happens server-side at /api/auth/verify-email
    // This client page just redirects to the API route which will redirect back
    window.location.href = `/api/auth/verify-email?token=${token}`;
  }, [token, router]);

  return (
    <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-card p-8 text-center max-w-sm w-full space-y-3">
        <p className="text-3xl">⏳</p>
        <p className="text-lg font-black text-navy-700">Verifying your email…</p>
        <p className="text-sm text-slate-500">Please wait a moment.</p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
