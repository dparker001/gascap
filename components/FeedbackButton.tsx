'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function FeedbackButton() {
  const pathname            = usePathname();
  const [open, setOpen]     = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');
  const textareaRef           = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when modal opens
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  // Hide on admin page
  if (pathname.startsWith('/admin')) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      const res  = await fetch('/api/feedback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, page: pathname }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? 'Send failed.'); return; }
      setSent(true);
      setMessage('');
      setTimeout(() => { setSent(false); setOpen(false); }, 2500);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 z-50 flex items-center gap-1.5 bg-navy-700
                   hover:bg-navy-600 text-white text-xs font-bold px-3 py-2.5 rounded-full
                   shadow-lg transition-all hover:scale-105 active:scale-95"
        aria-label="Send feedback"
      >
        <span>💬</span>
        <span>Share Feedback</span>
      </button>

      {/* Modal backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center
                     justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4
                          animate-fade-in">
            {sent ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-3xl">🙏</p>
                <p className="font-black text-navy-700">Thanks for your feedback!</p>
                <p className="text-sm text-slate-500">We read every message.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-navy-700">Share feedback</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Ideas, bugs, or anything on your mind.
                    </p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What's on your mind? Feature requests, bugs, anything…"
                    rows={4}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                               resize-none focus:outline-none focus:ring-2 focus:ring-amber-400
                               placeholder:text-slate-300"
                    maxLength={1000}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm
                                 font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!message.trim() || sending}
                      className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400
                                 disabled:opacity-40 text-white text-sm font-black transition-colors"
                    >
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
