'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';

export default function FeedbackButton() {
  const pathname            = usePathname();
  const { t }               = useTranslation();
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
      setError(t.feedback.networkError);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating trigger button — chat bubble icon, always bottom-left */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-4 z-50 flex items-center justify-center
                   bg-navy-700 hover:bg-navy-600 text-white rounded-full
                   shadow-lg transition-all hover:scale-105 active:scale-95
                   w-11 h-11"
        aria-label={t.feedback.ariaLabel}
      >
        {/* Chat bubble SVG */}
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M20 2H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h3l3 3 3-3h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/>
        </svg>
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
                <p className="font-black text-navy-700">{t.feedback.sentTitle}</p>
                <p className="text-sm text-slate-500">{t.feedback.sentSub}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-navy-700">{t.feedback.modalTitle}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t.feedback.modalSub}
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
                    placeholder={t.feedback.placeholder}
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
                      {t.feedback.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={!message.trim() || sending}
                      className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400
                                 disabled:opacity-40 text-white text-sm font-black transition-colors"
                    >
                      {sending ? t.feedback.sending : t.feedback.send}
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
