'use client';

import { useState } from 'react';
import TargetFillForm   from './TargetFillForm';
import BudgetForm       from './BudgetForm';
import EvCalculatorForm from './EvCalculatorForm';

export type CalcTab = 'target' | 'budget' | 'ev';

export default function CalculatorTabs() {
  const [active, setActive] = useState<CalcTab>('target');

  if (active === 'ev')     return <EvCalculatorForm  activeTab={active} setActiveTab={setActive} />;
  if (active === 'budget') return <BudgetForm        activeTab={active} setActiveTab={setActive} />;
  return                          <TargetFillForm    activeTab={active} setActiveTab={setActive} />;
}
