import assert from 'node:assert/strict';
export function patchWelcomeLetter(source) {
  if (source.includes('__carbShowWelcomeLetter')) return source;
  const anchor = 'onDismiss:()=>{if(ve(!1),fe){pe(!1);return}LP(OM,`done`),ue(!0)';
  assert.equal(source.split(anchor).length, 2, 'Onboarding completion anchor must occur once');
  return "import {showWelcomeLetter as __carbShowWelcomeLetter} from './carb-welcome-letter.js';\n" + source.replace(anchor, anchor + ',__carbShowWelcomeLetter()');
}
