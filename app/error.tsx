'use client';

import { useEffect } from 'react';

/**
 * Next.js App Router error boundary page.
 * Catches errors thrown during rendering of any route segment
 * and shows a recovery UI rather than a blank screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GasCap] Page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#eef1f7] dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
        {/* Logo */}
        <div className="text-4xl mb-4">⛽</div>

        <h1 className="text-xl font-black text-slate-800 dark:text-slate-100 mb-2">
          Oops — something broke
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          An unexpected error occurred. Your saved vehicles and fill-up history are safe.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full py-3 bg-amber-400 hover:bg-amber-500 text-slate-900 font-black rounded-xl text-sm transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="w-full py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-sm transition-colors"
          >
            Back to Home
          </a>
        </div>

        {error.digest && (
          <p className="mt-4 text-[10px] text-slate-300 dark:text-slate-600 font-mono">
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
