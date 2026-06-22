/** Trust signals — shown on the landing page guest section. */
export default function TrustStrip() {
  const signals = [
    { icon: '📱', text: 'Works offline — no signal needed' },
    { icon: '🔒', text: 'We never sell your data' },
    { icon: '📊', text: 'Powered by U.S. EIA official data' },
    { icon: '✓',  text: 'No credit card to start' },
  ];

  return (
    <section className="px-4 pb-5 max-w-lg mx-auto w-full">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3.5">

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-emerald-200" />
          <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest whitespace-nowrap">
            Why drivers trust GasCap™
          </span>
          <div className="flex-1 h-px bg-emerald-200" />
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {signals.map(({ icon, text }) => (
            <div key={text} className="flex items-start gap-1.5">
              <span className="text-emerald-500 text-sm flex-shrink-0 mt-px" aria-hidden="true">
                {icon}
              </span>
              <span className="text-[11px] font-semibold text-emerald-800 leading-snug">
                {text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
