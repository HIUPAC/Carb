import assert from 'node:assert/strict';

export const contactUrl = 'https://houpac.top/';
export const releasesUrl = 'https://github.com/HIUPAC/Carb/releases';

// Reuse the Settings navigation button and the existing desktop link bridge.
// Both actions open their web page directly, without selecting a settings tab.
export function patchContactSettings(name, source) {
  if (!/(?:^|\/)Settings-[^/]+\.js$/.test(name)) return source;
  if (source.includes('function __carbOpenSettingsLink(') && source.includes('function __carbUpdatesSettingsButton(')) return source;
  const anchor = 'onClick:()=>o(`data`)}),i.showDebug?';
  // Upgrade an already transformed contact-only payload as well as a clean one.
  if (source.includes('function __carbContactSettingsButton(')) {
    const legacy = /^const __carbContactUrl=[^\r\n]*\r?\nasync function __carbOpenContactPage\(\)[^\r\n]*\r?\nfunction __carbContactSettingsButton\(\)[^\r\n]*\r?\n/;
    assert(legacy.test(source), 'Unrecognized legacy Settings contact helper');
    source = source.replace(legacy, '');
    const legacyAnchor = 'onClick:()=>o(`data`)}),__carbContactSettingsButton(),i.showDebug?';
    assert.equal(source.split(legacyAnchor).length, 2, 'Legacy Settings contact action anchor missing or ambiguous');
    source = source.replace(legacyAnchor, anchor);
  }
  assert.equal(source.split(anchor).length, 2, 'Settings link actions anchor missing or ambiguous');
  source = source.replace(anchor, 'onClick:()=>o(`data`)}),__carbContactSettingsButton(),__carbUpdatesSettingsButton(),i.showDebug?');
  const helper = `const __carbContactUrl=${JSON.stringify(contactUrl)};
const __carbReleasesUrl=${JSON.stringify(releasesUrl)};
function __carbSettingsLinkCopy(){const language=__testLocale();return language===\`zh-CN\`?{contact:\`联系我们\`,updates:\`检查更新\`,failed:\`无法打开网页，请在浏览器中访问：\`}:language===\`ja\`?{contact:\`お問い合わせ\`,updates:\`更新を確認\`,failed:\`ページを開けません。ブラウザーで次の URL にアクセスしてください：\`}:{contact:\`Contact us\`,updates:\`Check for updates\`,failed:\`Unable to open the page. Please open this address in your browser: \`}}
async function __carbOpenSettingsLink(url){try{const bridge=window.carb??window.harness;const open=bridge?.openTaskExternal??bridge?.openExternal;if(typeof open!==\`function\`)throw new Error(\`External link bridge is unavailable\`);await open.call(bridge,url)}catch(error){console.error(\`[Carb] Settings link could not be opened\`,error);window.alert(__carbSettingsLinkCopy().failed+url)}}
function __carbOpenContactPage(){return __carbOpenSettingsLink(__carbContactUrl)}
function __carbOpenUpdatesPage(){return __carbOpenSettingsLink(__carbReleasesUrl)}
function __carbSettingsLinkButton(label,onClick){return(0,q.jsx)($,{active:!1,icon:(0,q.jsx)(i,{size:15,\"aria-hidden\":!0}),label,onClick})}
function __carbContactSettingsButton(){return __carbSettingsLinkButton(__carbSettingsLinkCopy().contact,__carbOpenContactPage)}
function __carbUpdatesSettingsButton(){return __carbSettingsLinkButton(__carbSettingsLinkCopy().updates,__carbOpenUpdatesPage)}
`;
  return helper + source;
}
