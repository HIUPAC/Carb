import assert from 'node:assert/strict';

// Keep CLI readiness separate from the auxiliary desktop-app signal. In-flight
// install/check/error labels still take priority over the static missing label.
export function formatCliInstallStatus(provider, status, language, translate, composeStatus = (_label, content) => content) {
  if (provider?.id !== 'codex') return status;
  const chinese = language === 'zh-CN';
  if (!provider.installed) {
    if (status !== translate('Not installed') && status !== '桌面版已安装，需安装 CLI') return status;
    return provider.desktopInstalled
      ? chinese ? '桌面版已安装，需安装 CLI' : 'Desktop installed; CLI required'
      : chinese ? 'CLI 未安装' : 'CLI not installed';
  }
  const label = provider.desktopInstalled
    ? chinese ? 'CLI、桌面版均已安装' : 'CLI + desktop installed'
    : chinese ? 'CLI 已安装' : 'CLI installed';
  const installed = translate('Installed');
  if (!status || status === installed) return label;
  // A signed-in provider supplies an account React node containing its email
  // and plan. Preserve that node while adding the CLI label around it.
  if (typeof status !== 'string') return composeStatus(label, status);
  if (status.endsWith(` · ${installed}`)) return status.slice(0, -installed.length) + label;
  return `${label} · ${status}`;
}

export function cliStatusHelper(jsxRuntime) {
  assert(/^[A-Za-z_$][\w$]*$/.test(jsxRuntime), 'Expected a JSX runtime identifier');
  return `function __carbCliStatus(provider,status){return (${formatCliInstallStatus.toString()})(provider,status,__testLocale(),__testT,(label,content)=>${jsxRuntime}.jsxs(${jsxRuntime}.Fragment,{children:[label,\` · \`,content]}))}\n`;
}

function replaceOnce(source, before, after, message) {
  assert.equal(source.split(before).length, 2, message);
  return source.replace(before, after);
}

export function patchCliStatusWeb(name, source) {
  if (/(?:^|\/)Settings-[^/]+\.js$/.test(name)) {
    if (source.includes('function __carbCliStatus(')) return source;
    source = replaceOnce(source,
      'className:`provider-row__status-text`,children:e.status',
      'className:`provider-row__status-text`,children:__carbCliStatus(e.provider,e.status)',
      'Provider status row anchor missing');
    source = replaceOnce(source,
      'className:`provider-row__mark`,title:e.provider.version',
      'className:`provider-row__mark`,title:[e.provider.version,e.provider.cliPath].filter(Boolean).join(`\\n`)||void 0',
      'Provider CLI location tooltip anchor missing');
    return cliStatusHelper('q') + source;
  }
  if (/(?:^|\/)Onboarding-[^/]+\.js$/.test(name)) {
    if (source.includes('function __carbCliStatus(')) return source;
    source = replaceOnce(source,
      'state:r.label,installed:n?.installed??!0',
      'state:__carbCliStatus(n,r.label),installed:n?.installed??!1',
      'Onboarding CLI status anchor missing');
    return cliStatusHelper('A') + source;
  }
  if (/(?:^|\/)index-dY3kjCLH\.js$/.test(name)) {
    if (source.includes('desktopInstalled:H().optional(),cliPath:B().optional(),version:')) return source;
    source = replaceOnce(source,
      'Bc=W({id:q,displayName:B(),installed:H(),version:',
      'Bc=W({id:q,displayName:B(),installed:H(),desktopInstalled:H().optional(),cliPath:B().optional(),version:',
      'Provider status schema anchor missing');
    source = replaceOnce(source,
      'P_=g_({id:T_,displayName:__,installed:v_,version:',
      'P_=g_({id:T_,displayName:__,installed:v_,desktopInstalled:x_(v_),cliPath:x_(__),version:',
      'Provider status fast validator anchor missing');
    return replaceOnce(source,
      'return!t||t.installed!==e.installed||(t.problem??``)!==(e.problem??``)',
      'return!t||t.installed!==e.installed||!!t.desktopInstalled!==!!e.desktopInstalled||(t.cliPath??``)!==(e.cliPath??``)||(t.problem??``)!==(e.problem??``)',
      'Provider installation state refresh anchor missing');
  }
  return source;
}
