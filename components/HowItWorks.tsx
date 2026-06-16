// Gas Cap™ — How it works explainer section
'use client';

import { useTranslation } from '@/contexts/LanguageContext';

export default function HowItWorks() {
  const { t } = useTranslation();

  const STEPS = [
    {
      n: '1',
      title: t.howItWorks.step1Title,
      body: t.howItWorks.step1Body,
      color: 'bg-navy-700',
    },
    {
      n: '2',
      title: t.howItWorks.step2Title,
      body: t.howItWorks.step2Body,
      color: 'bg-amber-500',
    },
    {
      n: '3',
      title: t.howItWorks.step3Title,
      body: t.howItWorks.step3Body,
      color: 'bg-navy-700',
    },
    {
      n: '4',
      title: t.howItWorks.step4Title,
      body: t.howItWorks.step4Body,
      color: 'bg-amber-500',
    },
  ];

  return (
    <section aria-labelledby="hiw-heading">
      <h2 id="hiw-heading" className="section-eyebrow">
        {t.howItWorks.heading}
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
        {t.howItWorks.finePrint}
      </p>
    </section>
  );
}
