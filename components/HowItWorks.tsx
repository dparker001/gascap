// Gas Cap™ — How it works explainer section

const STEPS = [
  {
    n: '1',
    title: 'Pick your vehicle',
    body: "Choose from common vehicles in the dropdown or type your exact tank size in gallons.",
    color: 'bg-navy-700',
  },
  {
    n: '2',
    title: 'Set your current level',
    body: "Drag the fuel gauge handle to your current level, or switch to gallons mode and type it in.",
    color: 'bg-amber-500',
  },
  {
    n: '3',
    title: 'Choose your goal',
    body: "Target Fill: pick how full you want the tank. By Budget: enter how much you want to spend.",
    color: 'bg-navy-700',
  },
  {
    n: '4',
    title: 'Get your answer',
    body: "See gallons needed and exact cost — no math, no guessing at the pump.",
    color: 'bg-amber-500',
  },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="hiw-heading">
      <h2 id="hiw-heading" className="section-eyebrow">
        How it works
      </h2>

      <div className="space-y-3">
        {STEPS.map((step) => (
          <div key={step.n} className="card flex items-start gap-4">
            {/* Numbered circle */}
            <div
              className={`w-10 h-10 rounded-2xl ${step.color} flex items-center justify-center flex-shrink-0`}
              aria-hidden="true"
            >
              <span className="text-white text-base font-black">{step.n}</span>
            </div>
            <div className="pt-0.5">
              <p className="font-bold text-slate-800 text-sm">{step.title}</p>
              <p className="text-slate-500 text-sm mt-1 leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Fine print */}
      <p className="text-center text-xs text-slate-400 mt-6 leading-relaxed px-2">
        GasCap™ results are estimates for planning purposes.
        Actual pump prices and fill amounts may vary slightly.
      </p>
    </section>
  );
}
