'use client';

import { useState, useEffect } from 'react';
import TargetFillForm   from './TargetFillForm';
import BudgetForm       from './BudgetForm';
import EvCalculatorForm from './EvCalculatorForm';

export type CalcTab = 'target' | 'budget' | 'ev';

/**
 * Which calculator is showing is local state, but the native header's
 * VehicleChip is a sibling in NativeAppShell and needs to know — it filters the
 * garage by fuel type (no point offering a gas truck while you're costing a
 * charge) and switches tabs when you pick a vehicle the current tab can't
 * handle. Same custom-event pattern the shell already uses for
 * `gc:rental-mode` and `gc:switch-tab`.
 */
export const CALC_TAB_EVENT     = 'gc:calc-tab';      // broadcast: active tab changed
export const SET_CALC_TAB_EVENT = 'gc:set-calc-tab';  // request: switch to a tab

export default function CalculatorTabs() {
  const [active, setActive] = useState<CalcTab>('target');

  // Broadcast the active tab so the header chip can filter to matching vehicles.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CALC_TAB_EVENT, { detail: { tab: active } }));
  }, [active]);

  // Let the chip switch tabs — picking an EV from the garage should land on the
  // EV calculator rather than silently loading a battery into a tank-size field.
  useEffect(() => {
    function handler(e: Event) {
      const tab = (e as CustomEvent<{ tab?: CalcTab }>).detail?.tab;
      if (tab === 'target' || tab === 'budget' || tab === 'ev') setActive(tab);
    }
    window.addEventListener(SET_CALC_TAB_EVENT, handler);
    return () => window.removeEventListener(SET_CALC_TAB_EVENT, handler);
  }, []);

  if (active === 'ev')     return <EvCalculatorForm  activeTab={active} setActiveTab={setActive} />;
  if (active === 'budget') return <BudgetForm        activeTab={active} setActiveTab={setActive} />;
  return                          <TargetFillForm    activeTab={active} setActiveTab={setActive} />;
}
