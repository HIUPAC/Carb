// Kept separate from the compiled Settings bundle so the install state machine
// can be reviewed and tested without changing the upstream renderer.
export function createSkillInstaller(React, runtime) {
  const { useState, useEffect, useRef } = React;
  const { jsx, jsxs } = runtime;
  const zh = () => document.documentElement.lang.toLowerCase().startsWith('zh');
  const t = (cn, en) => zh() ? cn : en;
  const message = error => error instanceof Error ? error.message : String(error);
  const blocked = skill => Boolean(skill.blockedReason || skill.alreadyExists);
  const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

  return function SkillInstaller({ enabled, busy, transport, provider, projectPath, onInstalled }) {
    const [mode, setMode] = useState('zip');
    const [source, setSource] = useState('');
    const [phase, setPhase] = useState('idle');
    const [preview, setPreview] = useState(null);
    const [selected, setSelected] = useState([]);
    const [failure, setFailure] = useState('');
    const [notice, setNotice] = useState('');
    const current = useRef({});
    const sourceRef = useRef('');
    const previewRef = useRef(null);
    const operation = useRef(0);
    const activeRequest = useRef(null);
    const id = React.useId();
    const working = phase === 'previewing' || phase === 'installing';
    current.current = { transport, provider, projectPath, enabled, busy, working };
    sourceRef.current = source;
    const contextMatches = context => current.current.transport === context.transport && current.current.provider === context.provider && current.current.projectPath === context.projectPath;
    const discard = value => { if (value?.previewId) void transport.request('skills.discardInstall', { previewId: value.previewId }).catch(() => {}); };
    const discardArchive = value => {
      const bridge = window.carb ?? window.harness;
      return Promise.resolve(bridge?.discardSkillArchive?.(value)).catch(() => {});
    };
    useEffect(() => {
      operation.current++;
      activeRequest.current = null;
      setPreview(null); setSelected([]); setFailure(''); setNotice(''); setPhase('idle');
      return () => {
        operation.current++; activeRequest.current = null; discard(previewRef.current); previewRef.current = null;
        const bridge = window.carb ?? window.harness;
        if (sourceRef.current) void discardArchive(sourceRef.current);
      };
    }, [transport, provider, projectPath]);
    const clearPreview = () => {
      discard(previewRef.current); previewRef.current = null;
      const previousSource = sourceRef.current;
      sourceRef.current = '';
      if (previousSource) void discardArchive(previousSource);
      setSource('');
      setPreview(null); setSelected([]); setFailure(''); setNotice(''); setPhase('idle');
    };
    const inspect = async value => {
      if (!current.current.enabled || current.current.busy || current.current.working || activeRequest.current !== null || !value.trim()) return null;
      const context = { ...current.current };
      const token = ++operation.current;
      activeRequest.current = token;
      discard(previewRef.current); previewRef.current = null;
      setPreview(null); setFailure(''); setNotice(''); setPhase('previewing');
      try {
        const result = await transport.request('skills.previewInstall', { provider, projectPath, source: value.trim() });
        if (token !== operation.current || !contextMatches(context)) { discard(result); return; }
        previewRef.current = result; setPreview(result);
        setSelected(result.skills.filter(skill => !blocked(skill)).map(skill => skill.id));
        setPhase('review');
        return result;
      } catch (error) {
        if (token === operation.current && contextMatches(context)) { setFailure(message(error)); setPhase('idle'); }
        return null;
      } finally { if (activeRequest.current === token) activeRequest.current = null; }
    };
    const inspectAndReleaseArchive = async value => {
      const result = await inspect(value);
      if (result) await discardArchive(value);
      return result;
    };
    useEffect(() => {
      const bridge = window.carb ?? window.harness;
      if (!bridge?.onSkillArchiveDownloaded) return;
      const context = { transport, provider, projectPath };
      return bridge.onSkillArchiveDownloaded(async filePath => {
        if (!contextMatches(context) || !filePath.toLowerCase().endsWith('.zip')) {
          await bridge.discardSkillArchive?.(filePath).catch(() => {});
          return;
        }
        if (activeRequest.current !== null || current.current.busy) {
          setSource(filePath);
          setFailure(t('已有技能检查或安装正在进行。完成当前操作后，点击“重新检查来源”继续此 ZIP。', 'A skill check or install is already running. Finish it, then choose “Review source again” to inspect this ZIP.'));
          return;
        }
        clearPreview();
        setMode('zip'); setSource(filePath);
        await inspectAndReleaseArchive(filePath);
      });
    }, [transport, provider, projectPath]);
    const pick = async kind => {
      const bridge = window.carb ?? window.harness;
      const context = { ...current.current };
      setFailure('');
      try {
        const picker = kind === 'zip' ? bridge?.pickSkillZip : bridge?.pickSkillFolder;
        if (!picker) throw new Error(t('当前运行版本不支持此文件选择器，请更新 Carb 后重试。', 'Update Carb to use this file picker.'));
        const value = await picker();
        if (!value || !contextMatches(context)) return;
        if (sourceRef.current && sourceRef.current !== value) await discardArchive(sourceRef.current);
        setSource(value); await inspectAndReleaseArchive(value);
      } catch (error) { if (contextMatches(context)) setFailure(message(error)); }
    };
    const install = async () => {
      if (!enabled || !preview || working || busy || activeRequest.current !== null || !selected.length) return;
      const context = { ...current.current };
      const token = ++operation.current;
      activeRequest.current = token;
      setPhase('installing'); setFailure('');
      try {
        const result = await transport.request('skills.commitInstall', { provider, projectPath, previewId: preview.previewId, skillIds: selected });
        if (token !== operation.current || !contextMatches(context)) return;
        previewRef.current = null; setPreview(null); setSelected([]);
        setNotice(t(`已安装 ${result.installed.length} 个技能。可在下方查看并管理启用状态。`, `${result.installed.length} skill(s) installed. Manage their enabled state below.`) + (result.warnings?.length ? '\n' + result.warnings.join('\n') : ''));
        setPhase('done'); onInstalled?.(result);
      } catch (error) {
        if (token === operation.current && contextMatches(context)) { setFailure(message(error)); setPhase('review'); }
      } finally { if (activeRequest.current === token) activeRequest.current = null; }
    };
    const modes = [ ['zip', t('本地 ZIP', 'Local ZIP')], ['folder', t('技能文件夹', 'Skill folder')] ];
    const button = (label, onClick, disabled = false, primary = false) => jsx('button', { type: 'button', className: `set-button${primary ? ' carb-skill-primary' : ''}`, disabled, onClick, children: label });
    const locked = !enabled || busy || working;
    return jsxs('section', { className: 'carb-skill-installer', 'aria-labelledby': id, 'aria-busy': working, children: [
      jsxs('header', { className: 'carb-skill-installer__header', children: [jsx('h2', { id, children: t('安装技能', 'Install skills') }), jsx('span', { children: t('选择来源 → 检查内容 → 安装到 Crab 全局目录', 'Choose source → Review → Install to the Crab global directory') })] }),
      jsx('p', { className: 'carb-skill-installer__intro', children: t('从本地 ZIP 压缩包或技能文件夹导入。安装前可检查名称、说明和文件数量。', 'Import a local ZIP archive or skill folder. Review names, descriptions and file counts before installing.') }),
      jsx('div', { className: 'carb-skill-installer__tabs', role: 'group', 'aria-label': t('安装来源', 'Install source'), children: modes.map(([value, label]) => jsx('button', { type: 'button', 'aria-pressed': mode === value, disabled: working, onClick: () => { clearPreview(); setMode(value); setSource(''); }, children: label }, value)) }),
      jsxs('div', { className: 'carb-skill-installer__dropzone', children: [
        jsx('strong', { children: mode === 'zip' ? t('选择包含 SKILL.md 的 ZIP 压缩包', 'Choose a ZIP containing SKILL.md') : t('选择包含 SKILL.md 的本地目录', 'Choose a local directory containing SKILL.md') }),
        jsx('p', { children: t('支持一个技能或多个技能组成的集合。', 'A single skill or a collection of skills is supported.') }),
        button(mode === 'zip' ? t('选择 ZIP 文件', 'Choose ZIP file') : t('选择技能文件夹', 'Choose skill folder'), () => void pick(mode), locked),
        source ? jsx('code', { title: source, children: source }) : null
      ] }),
      !enabled ? jsx('p', { className: 'carb-skill-installer__hint', children: t('当前代理不支持技能安装，请切换到支持技能安装的代理。', 'The current agent does not support skill installation.') }) : null,
      working ? jsxs('p', { role: 'status', className: 'carb-skill-installer__status', children: [jsx('span', { className: 'carb-skill-installer__spinner', 'aria-hidden': true }), phase === 'previewing' ? t('正在读取来源并校验技能文件…', 'Reading source and validating skill files…') : t('正在安装并确认代理已发现技能…', 'Installing and confirming agent discovery…')] }) : null,
      preview ? jsxs('div', { className: 'carb-skill-installer__review', children: [
        jsx('h3', { children: t(`发现 ${preview.skills.length} 个技能`, `${preview.skills.length} skill(s) found`) }),
        jsx('p', { className: 'carb-skill-installer__destination', children: t('安装位置：', 'Destination: ') + (preview.destination ?? projectPath) }),
        preview.revision ? jsx('small', { className: 'carb-skill-installer__destination', children: t('来源版本：', 'Source revision: ') + preview.revision }) : null,
        jsx('div', { className: 'carb-skill-installer__skills', children: preview.skills.map(skill => jsxs('label', { className: 'carb-skill-installer__skill', children: [
          jsx('input', { type: 'checkbox', checked: selected.includes(skill.id), disabled: working || blocked(skill), onChange: event => setSelected(previous => event.target.checked ? [...previous, skill.id] : previous.filter(value => value !== skill.id)) }),
          jsxs('span', { children: [jsx('strong', { children: skill.name }), skill.description ? jsx('span', { children: skill.description }) : null, jsx('small', { children: `${skill.relativePath || '.'} · ${skill.files} ${t('个文件', 'files')} · ${size(skill.bytes)}` }), blocked(skill) ? jsx('small', { className: 'carb-skill-installer__error', children: skill.blockedReason || t('项目内已有同名技能，请先处理冲突。', 'A skill with this name already exists. Resolve the conflict first.') }) : null] })
        ] }, skill.id)) }),
        preview.warnings?.length ? jsx('p', { className: 'carb-skill-installer__hint', children: preview.warnings.join('\n') }) : null,
        jsx('p', { className: 'carb-skill-installer__hint', children: t('请确认来源可信。安装仅复制技能文件；使用时，技能可能指导代理调用工具或脚本。已有技能不会被覆盖。', 'Confirm you trust the source. Installation copies skill files; skills may guide the agent to use tools or scripts. Existing skills are never overwritten.') }),
        jsxs('div', { className: 'carb-skill-installer__actions', children: [button(t('重新选择', 'Choose again'), clearPreview, working), failure ? button(t('重新检查来源', 'Review source again'), () => void inspectAndReleaseArchive(source), working || busy || !enabled) : null, button(t(`安装所选技能（${selected.length}）`, `Install selected (${selected.length})`), () => void install(), working || busy || !selected.length, true)] })
      ] }) : null,
      failure ? jsxs('div', { role: 'alert', className: 'carb-skill-installer__error', children: [jsx('p', { children: failure }), !working && source && !preview ? button(t('重试检查', 'Retry review'), () => void inspectAndReleaseArchive(source), !enabled || busy) : null] }) : null,
      notice ? jsx('p', { role: 'status', className: 'carb-skill-installer__success', children: notice }) : null,
      jsx('footer', { className: 'carb-skill-installer__footer', children: button(t('浏览技能页面', 'Browse Skill page'), () => { const bridge = window.carb ?? window.harness; if (bridge?.openSkillBrowser) void bridge.openSkillBrowser().catch(error => setFailure(message(error))); else if (bridge?.openExternal) void bridge.openExternal('https://findskill.com/'); }) })
    ] });
  };
}

// Each row owns its operation state so one failed operation does not block the list.
export function createSkillManager(React, runtime) {
  const { useState } = React;
  const { jsx, jsxs } = runtime;
  const t = (cn, en) => document.documentElement.lang.toLowerCase().startsWith('zh') ? cn : en;
  return function SkillManager({ skill, transport, provider, projectPath, onChanged }) {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const name = skill.displayName || skill.name;
    const folder = skill.source?.type === 'folder' ? skill.source.path : '';
    async function action(fn) {
      if (busy) return;
      setBusy(true); setFailure('');
      try { await fn(); } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }
    const params = { provider, projectPath, skillId: skill.id };
    const toggle = () => action(async () => {
      await transport.request('skills.setManagedEnabled', { ...params, enabled: !skill.enabled });
      onChanged();
    });
    const remove = () => {
      if (!window.confirm(t(`确定删除技能“${name}”？此操作会删除该技能的本地文件。`, `Delete “${name}”? Its local files will be removed.`))) return;
      void action(async () => { await transport.request('skills.deleteManaged', params); onChanged(); });
    };
    const reveal = () => action(async () => {
      const bridge = window.carb ?? window.harness;
      if (!folder || !bridge?.revealPath) throw new Error(t('无法打开此技能的本地位置。', 'Cannot reveal this skill location.'));
      await bridge.revealPath(folder);
    });
    return jsxs('article', { className: 'set-entity carb-skill-managed', 'data-tone': skill.enabled ? undefined : 'muted', children: [
      jsx('div', { className: 'set-entity__main', children: jsxs('div', { className: 'set-entity__head', children: [jsx('h2', { className: 'set-entity__name', children: name }), jsx('span', { className: 'set-leader', 'aria-hidden': true }), jsx('span', { className: 'set-entity__status', children: skill.enabled ? t('已启用', 'Enabled') : t('已停用', 'Disabled') })] }) }),
      jsxs('div', { className: 'set-entity__actions carb-skill-managed__actions', children: [
        jsx('button', { type: 'button', className: `switch${skill.enabled ? ' is-on' : ''}`, role: 'switch', 'aria-label': `${skill.enabled ? t('停用', 'Disable') : t('启用', 'Enable')} ${name}`, 'aria-checked': skill.enabled, disabled: busy, onClick: toggle, children: jsx('span', { className: 'switch__thumb' }) }),
        jsx('button', { type: 'button', className: 'set-button', disabled: busy || !folder, onClick: reveal, children: t('打开位置', 'Open location') }),
        jsx('button', { type: 'button', className: 'set-button', disabled: busy || !folder, onClick: remove, children: t('删除', 'Delete') })
      ] }),
      jsxs('div', { className: 'set-entity__details', children: [skill.description ? jsx('p', { className: 'set-entity__detail', children: skill.description }) : null, jsx('p', { className: 'set-entity__detail set-entity__detail--code', title: folder, children: folder || t('由代理管理', 'Managed by provider') }), ...(skill.dependencyErrors || []).map((error, index) => jsx('p', { className: 'set-entity__detail set-entity__detail--error', children: `${error.dependency} · ${error.message}` }, index)), failure ? jsx('p', { role: 'alert', className: 'set-entity__detail set-entity__detail--error', children: failure }) : null] })
    ] });
  };
}
