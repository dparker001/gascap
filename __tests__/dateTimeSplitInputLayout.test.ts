/**
 * Post-release fix (2026-08-26) — the datetime-local → split date/time
 * replacement narrowed the iOS overflow but didn't fully fix it. This repo's
 * vitest config has no JSX/React render harness (environment: 'node', no
 * @vitejs/plugin-react — see vitest.config.ts), so there is no way to mount
 * DateTimeSplitInput and measure real layout here. These tests do NOT prove
 * the fields fit on an iPhone; they only guard the structural CSS
 * requirements this fix depends on (mobile single-column stacking, explicit
 * width/min-width at every layer, WebKit shadow-DOM overrides) so a future
 * edit can't silently drop one. Actual on-device confirmation is the manual
 * iOS verification checklist, not this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const componentSrc = readFileSync(
  join(__dirname, '../components/rental-return/DateTimeSplitInput.tsx'),
  'utf8',
);
const modalShellSrc = readFileSync(
  join(__dirname, '../components/rental-return/ModalShell.tsx'),
  'utf8',
);
const globalsCss = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');

describe('DateTimeSplitInput — mobile layout structure', () => {
  it('stacks single-column by default and only goes 2-column at sm+', () => {
    expect(componentSrc).toMatch(/grid-cols-1\s+sm:grid-cols-2/);
  });

  it('does not force a fixed grid-template-columns inline (would defeat the sm: breakpoint)', () => {
    expect(componentSrc).not.toMatch(/gridTemplateColumns/);
  });

  it('both inputs carry explicit inline width/min-width/box-sizing as a belt-and-suspenders layer', () => {
    const dateInput = componentSrc.match(/<input\s+type="date"[\s\S]*?\/>/)?.[0] ?? '';
    const timeInput = componentSrc.match(/<input\s+type="time"[\s\S]*?\/>/)?.[0] ?? '';
    for (const input of [dateInput, timeInput]) {
      expect(input).toMatch(/style=\{fieldStyle\}/);
      expect(input).toMatch(/min-w-0/);
      expect(input).toMatch(/rental-datetime-input/);
    }
  });

  it('the shared fieldStyle object sets width/max-width/min-width/box-sizing/display', () => {
    const styleBlock = componentSrc.match(/const fieldStyle:[\s\S]*?\};/)?.[0] ?? '';
    expect(styleBlock).toMatch(/width:\s*'100%'/);
    expect(styleBlock).toMatch(/maxWidth:\s*'100%'/);
    expect(styleBlock).toMatch(/minWidth:\s*0/);
    expect(styleBlock).toMatch(/boxSizing:\s*'border-box'/);
    expect(styleBlock).toMatch(/display:\s*'block'/);
  });
});

describe('globals.css — date/time input sizing rules', () => {
  it('applies width/max-width/min-width/box-sizing to date, time, and datetime-local inputs', () => {
    const rule = globalsCss.match(/input\[type="date"\][\s\S]*?box-sizing:\s*border-box;\s*\}/)?.[0] ?? '';
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  it('reaches into the WebKit shadow-DOM parts that the outer box rule cannot', () => {
    expect(globalsCss).toMatch(/::-webkit-datetime-edit/);
    expect(globalsCss).toMatch(/::-webkit-datetime-edit-fields-wrapper/);
    expect(globalsCss).toMatch(/::-webkit-date-and-time-value/);
  });

  it('defines .rental-datetime-input with full-width, shrinkable sizing', () => {
    const rule = globalsCss.match(/\.rental-datetime-input\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  it('.rental-datetime-input keeps less horizontal padding than .input-field (the iOS overflow headroom)', () => {
    const rule = globalsCss.match(/\.rental-datetime-input\s*\{[\s\S]*?\}/)?.[0] ?? '';
    // px-3, not the px-4 .input-field uses and not reverted back to px-2 —
    // the visual-polish pass moved padding up from px-2 toward .input-field's
    // px-4 without fully closing the gap that avoids the shadow-DOM overflow.
    expect(rule).toMatch(/@apply input-field px-3 py-3;/);
  });

  it('trims the native calendar/clock icon padding to reclaim visual inset on the right edge', () => {
    expect(globalsCss).toMatch(/::-webkit-calendar-picker-indicator/);
  });
});

describe('globals.css — device-proven WKWebView content-box width compensation (2026-08-27)', () => {
  // Every rule above this point (shadow-DOM part padding, wrapper min-width,
  // border-box on .rental-datetime-input) shipped in PR #35 and was verified
  // fresh in production, yet the overflow was STILL reproducible live on the
  // affected iPhone via Safari Web Inspector. Measured there:
  //   before: parentWidth 344px, computed width 344px, outer/rendered width
  //     370px (+26px overflow), boxSizing reported as content-box EVEN with
  //     `box-sizing: border-box !important` applied.
  //   after adding `width/max-width: calc(100% - 26px)`: outer width 344px,
  //     matches parentWidth exactly, 0 overflow.
  // jsdom cannot execute layout or report computed box-sizing the way a real
  // WKWebView does, so this test only guards that the specific compensating
  // rule (not a generic width:100% that WKWebView silently mis-sizes) is
  // present and scoped to exactly these two inputs — not a claim that this
  // test itself proves the on-device fit.
  it('date and time inputs both get the 26px width compensation, not a plain 100%', () => {
    const rule = globalsCss.match(
      /input\.rental-datetime-input\[type="date"\][\s\S]*?\}/,
    )?.[0] ?? '';
    expect(rule).toMatch(/input\.rental-datetime-input\[type="date"\]/);
    expect(rule).toMatch(/input\.rental-datetime-input\[type="time"\]/);
    expect(rule).toMatch(/width:\s*calc\(100% - 26px\)/);
    expect(rule).toMatch(/max-width:\s*calc\(100% - 26px\)/);
  });

  it('the compensation is scoped to .rental-datetime-input only, not every date/time input on the site', () => {
    const matches = globalsCss.match(/calc\(100% - 26px\)/g) ?? [];
    // exactly 2 occurrences: width and max-width, both inside the single
    // input.rental-datetime-input[type=...] rule above — a global
    // input[type="date"] rule would indicate this leaked beyond the rental
    // return fields.
    expect(matches).toHaveLength(2);
    expect(globalsCss).not.toMatch(/^input\[type="date"\]\s*\{\s*width:\s*calc/m);
  });
});

describe('ModalShell — flex chain does not block shrinking', () => {
  it('the panel is a flex child with min-w-0, not just max-w-sm', () => {
    const panelDiv = modalShellSrc.match(/className="bg-white rounded-3xl[^"]*"/)?.[0] ?? '';
    expect(panelDiv).toMatch(/max-w-sm/);
    expect(panelDiv).toMatch(/min-w-0/);
  });
});
