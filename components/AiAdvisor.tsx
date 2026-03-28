'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface Vehicle { name: string; gallons: number; fuelType?: string; }
interface GarageResp { vehicles: Vehicle[]; }

interface Message {
  role:    'user' | 'assistant';
  content: string;
  loading?: boolean;
}

const PROMPT_CHIPS = [
  { emoji: '📉', text: 'Why might my MPG be dropping?' },
  { emoji: '💰', text: 'Am I on track with my fuel budget?' },
  { emoji: '🔮', text: 'Predict my fuel cost next month' },
  { emoji: '⚡', text: 'How can I improve my fuel efficiency?' },
  { emoji: '🛣️', text: 'Tips for maximizing range on a long trip' },
  { emoji: '🔧', text: 'When might my vehicle need maintenance?' },
];

export default function AiAdvisor({ embedded = false }: { embedded?: boolean }) {
  const { data: session, status } = useSession();

  const [open,     setOpen]     = useState(embedded);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isOpen = embedded || open;

  // Load garage vehicles once when panel opens
  const loadVehicles = useCallback(async () => {
    if (!session || vehicles.length > 0) return;
    try {
      const r = await fetch('/api/vehicles');
      if (r.ok) {
        const d = await r.json() as GarageResp;
        setVehicles(d.vehicles ?? []);
      }
    } catch { /* silent */ }
  }, [session, vehicles.length]);

  // Check if AI is configured on first open
  useEffect(() => {
    if (isOpen && configured === null) {
      // Probe with an empty question — server will 400 (fine) or 503 (not configured)
      fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: '' }),
      }).then((r) => {
        setConfigured(r.status !== 503);
      }).catch(() => setConfigured(false));
    }
  }, [isOpen, configured]);

  useEffect(() => {
    if (isOpen) loadVehicles();
  }, [isOpen, loadVehicles]);

  // Scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(question: string) {
    const q = question.trim();
    if (!q || loading) return;

    setMessages((prev) => [
      ...prev,
      { role: 'user',      content: q },
      { role: 'assistant', content: '', loading: true },
    ]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q, vehicles }),
      });
      const data = await res.json() as { answer?: string; error?: string };

      setMessages((prev) => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            role:    'assistant',
            content: data.answer ?? data.error ?? 'Sorry, something went wrong.',
            loading: false,
          };
        }
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            role: 'assistant', content: 'Network error — please try again.', loading: false,
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading') return null;

  const isEmpty = messages.length === 0;

  return (
    <div className={embedded ? '' : 'mt-4'}>
      {/* Toggle header — hidden when embedded in tab panel */}
      {!embedded && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between py-3 px-4 bg-gradient-to-r from-navy-700 to-navy-600
                     rounded-2xl shadow-sm hover:from-navy-600 hover:to-navy-500 transition-all"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 flex items-center justify-center flex-shrink-0">
              <span className="text-base">🤖</span>
            </div>
            <div className="text-left">
              <p className="text-sm font-black text-white">GasCap AI Advisor</p>
              <p className="text-[10px] text-white/50">Ask anything about fuel, MPG, or your spending</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold bg-amber-400 text-navy-900 px-1.5 py-0.5 rounded-full">
              AI
            </span>
            <svg
              className={`w-4 h-4 text-white/50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </button>
      )}

      {isOpen && (
        <div className={embedded ? 'bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden' : 'mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden'}>

          {/* Not configured state */}
          {configured === false && (
            <div className="px-4 py-6 text-center space-y-2">
              <p className="text-2xl">🔑</p>
              <p className="text-sm font-bold text-slate-700">AI Advisor needs setup</p>
              <p className="text-xs text-slate-500 leading-relaxed max-w-[260px] mx-auto">
                Add your <code className="bg-slate-100 px-1 rounded text-[11px]">ANTHROPIC_API_KEY</code> to{' '}
                <code className="bg-slate-100 px-1 rounded text-[11px]">.env.local</code> to enable AI-powered insights.
              </p>
            </div>
          )}

          {configured !== false && (
            <>
              {/* Chat messages */}
              <div className="max-h-72 overflow-y-auto px-4 pt-4 space-y-3">
                {isEmpty && (
                  <div className="text-center py-3">
                    <p className="text-2xl mb-1.5">🤖</p>
                    <p className="text-sm font-bold text-slate-700">Hi! I&apos;m your GasCap AI Advisor.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {session
                        ? "I can see your vehicle and fillup data. Ask me anything!"
                        : "Ask me about fuel efficiency, cost savings, or trip planning."}
                    </p>
                  </div>
                )}

                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-navy-700 flex items-center justify-center
                                      flex-shrink-0 mr-2 mt-0.5 text-[11px]">
                        🤖
                      </div>
                    )}
                    <div
                      className={[
                        'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                        m.role === 'user'
                          ? 'bg-amber-500 text-white rounded-br-md'
                          : 'bg-slate-50 text-slate-700 border border-slate-100 rounded-bl-md',
                      ].join(' ')}
                    >
                      {m.loading ? (
                        <div className="flex items-center gap-1.5 py-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Prompt chips — only when empty */}
              {isEmpty && (
                <div className="px-4 pb-3 pt-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                    Suggested questions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_CHIPS.map((chip) => (
                      <button
                        key={chip.text}
                        onClick={() => sendMessage(chip.text)}
                        disabled={loading}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-50
                                   border border-slate-200 text-xs text-slate-600 font-medium
                                   hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700
                                   transition-colors disabled:opacity-40"
                      >
                        <span>{chip.emoji}</span>
                        <span>{chip.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input bar */}
              <div className="border-t border-slate-100 px-3 py-3 flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2
                             text-sm text-slate-800 placeholder-slate-400
                             focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent"
                  placeholder="Ask about fuel, MPG, costs…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  disabled={loading}
                  aria-label="Ask GasCap AI"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={loading || !input.trim()}
                  className="w-9 h-9 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40
                             transition-colors flex items-center justify-center flex-shrink-0"
                  aria-label="Send"
                >
                  <svg viewBox="0 0 16 16" className="w-4 h-4 text-white" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 8h12M8 2l6 6-6 6"/>
                  </svg>
                </button>
              </div>

              {/* Disclaimer */}
              <p className="text-[9px] text-slate-300 text-center pb-2">
                AI responses are for informational purposes · Always verify safety-critical vehicle info
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
