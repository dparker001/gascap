/**
 * The Business / Fleet mode changes nothing in the app (only 'gig' and
 * 'rental' are read anywhere) and the fleet plan is not purchasable, so its
 * copy must not promise tracking features. It stays a valid, selectable mode
 * so existing users and the demand signal are preserved.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const fleetCard = (() => {
  const s = read('components/UserModeSelector.tsx');
  const i = s.indexOf("id:    'fleet'");
  return s.slice(i, s.indexOf('},', i));
})();

describe('Business / Fleet mode copy', () => {
  it('the card no longer promises fuel/cost tracking and says fleet tools are coming soon', () => {
    expect(fleetCard).not.toMatch(/Track fuel usage and vehicle costs/);
    expect(fleetCard).toMatch(/coming soon/i);
  });
  it('Settings labels the option as coming soon', () => {
    expect(read('app/settings/page.tsx')).toMatch(/value="fleet">🚚 Business \/ Fleet \(fleet tools coming soon\)/);
  });
  it('help page and AI feature block describe it honestly', () => {
    expect(read('app/help/page.tsx')).toMatch(/Business\/Fleet is a "coming soon" choice/);
    expect(read('app/api/ai/chat/route.ts')).toMatch(/Business\/Fleet is a "coming soon" choice/);
    expect(read('app/api/ai/chat/route.ts')).toMatch(/do not promise a fleet launch date/);
  });
  it('fleet stays a valid, selectable mode (nothing removed or disabled)', () => {
    expect(read('app/api/user/profile/route.ts')).toMatch(/VALID_MODES = \['personal', 'gig', 'rental', 'fleet'\]/);
    expect(read('app/api/analytics/event/route.ts')).toMatch(/v === 'fleet'/);
    expect(read('components/UserModeSelector.tsx')).toMatch(/id:    'fleet'/);
    expect(read('app/settings/page.tsx')).toMatch(/<option value="fleet">/);
    expect(read('components/UserModeSelector.tsx')).not.toMatch(/disabled=\{[^}]*fleet/);
  });
  it('no app behaviour is keyed on fleet mode (it is a label only)', () => {
    for (const f of ['components/ToolsPanel.tsx', 'components/TargetFillForm.tsx', 'components/native/NativeAppShell.tsx']) {
      expect(read(f), f).not.toMatch(/userMode === 'fleet'|Mode === 'fleet'/);
    }
  });
});
