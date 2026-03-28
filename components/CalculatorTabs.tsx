'use client';

import { useState } from 'react';
import TargetFillForm from './TargetFillForm';
import BudgetForm     from './BudgetForm';

export type CalcTab = 'target' | 'budget';

export default function CalculatorTabs() {
  const [active, setActive] = useState<CalcTab>('target');

  return active === 'target'
    ? <TargetFillForm activeTab={active} setActiveTab={setActive} />
    : <BudgetForm     activeTab={active} setActiveTab={setActive} />;
}
