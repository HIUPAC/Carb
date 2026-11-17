function replaceOne(source, anchor, value, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(anchor, () => value);
}

function replaceUnlessPresent(source, anchor, value, marker, label) {
  if (source.includes(marker)) return source;
  if (source.includes(anchor)) return replaceOne(source, anchor, value, label);
  // The packaged orchestrator is CRLF while the patch anchors are kept as LF
  // literals. Match either newline form and emit the replacement in the file's
  // original newline style.
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(anchor.split('\n').map(escapeRegExp).join('\\r?\\n'), 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label}: expected one anchor, found ${matches.length}`);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.replace(pattern, () => value.replace(/\r?\n/g, newline));
}

function replaceMethod(source, start, end, value, label) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`${label}: method boundaries not found`);
  return source.slice(0, from) + value + source.slice(to);
}

export function patchSkillsListContract(source) {
  const marker = "'skills.list': {";
  if (!source.includes(marker)) throw new Error('skills.list contract: method not found');
  if (/'skills\.list':\s*\{\s*params:\s*z\.object\(\{\s*provider:\s*ProviderIdSchema,\s*projectPath:\s*z\.string\(\)\.min\(1\)\.optional\(\)/.test(source)) return source;
  const pattern = /('skills\.list': \{\r?\n\s*params: z\.object\(\{ provider: ProviderIdSchema, projectPath: z\.string\(\)\.min\(1\))(\s*\}\)),/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`skills.list contract: expected one schema anchor, found ${matches.length}`);
  return source.replace(pattern, '$1.optional()$2,');
}

export function patchSkillServer(source) {
  if (!source.includes("from './carb-skill-management.js'")) {
    source = replaceOne(source, "import path from 'node:path';", "import path from 'node:path';\nimport { managedSkillMethods, setManagedSkillEnabled, deleteManagedSkill } from './carb-skill-management.js';", 'skill management import');
    source = replaceOne(source, '    ...contractMethods,', '    ...contractMethods,\n    ...managedSkillMethods,', 'skill management methods');
    source = replaceOne(source, "            case 'skills.installFromFolder': {", "            case 'skills.setManagedEnabled':\n                return setManagedSkillEnabled(orchestrator, parseParams(method, params));\n            case 'skills.deleteManaged':\n                return deleteManagedSkill(orchestrator, parseParams(method, params));\n            case 'skills.installFromFolder': {", 'skill management routes');
  }
  if (source.includes("import { skillInstallMethods,")) return source;
  source = replaceOne(source, "import path from 'node:path';", "import path from 'node:path';\nimport { skillInstallMethods, previewSkillInstall, commitSkillInstall, discardSkillInstall } from './carb-skill-install.js';", 'skill installer import');
  source = replaceOne(source, '    ...contractMethods,', '    ...contractMethods,\n    ...skillInstallMethods,', 'skill installer methods');
  source = replaceOne(source, "            case 'skills.installFromFolder': {", "            case 'skills.previewInstall':\n                return previewSkillInstall(orchestrator, parseParams(method, params));\n            case 'skills.commitInstall':\n                return commitSkillInstall(orchestrator, parseParams(method, params));\n            case 'skills.discardInstall':\n                return discardSkillInstall(parseParams(method, params));\n            case 'skills.installFromFolder': {", 'skill installer route');
  return source;
}

export function patchSkillOrchestrator(source) {
  const skillInstallImport = "import { insideSkillFolder, installLocalSkill, sameSkillFolder } from './skill-install.js';";
  if (!source.includes("from './carb-skill-ownership.js'")) source = replaceOne(source, skillInstallImport, `${skillInstallImport}\nimport { removeInstalledSkill } from './carb-skill-ownership.js';`, 'skill cleanup import');
  if (!source.includes('return installSingleGlobalSkill(folderPath);')) source = replaceUnlessPresent(source, 'await rm(destination, { recursive: true, force: true });', 'await removeInstalledSkill(destination);', 'await removeInstalledSkill(destination);', 'skill discovery cleanup');
  if (!source.includes('installSingleGlobalSkill')) {
    if (source.includes("import { resolveSkillSource } from './carb-skill-source.js';")) source = replaceOne(source, "import { resolveSkillSource } from './carb-skill-source.js';", "import { installSingleGlobalSkill } from './carb-skill-install.js';", 'single skill import');
    else if (source.includes("from './carb-skill-install.js'")) source = source.replace(/import \{([^}]+)\} from '\.\/carb-skill-install\.js';/, (line, names) => `import { ${[...new Set([...names.split(',').map(name => name.trim()), 'installSingleGlobalSkill'])].join(', ')} } from './carb-skill-install.js';`);
    else source = replaceOne(source, skillInstallImport, `${skillInstallImport}\nimport { installSingleGlobalSkill } from './carb-skill-install.js';`, 'single skill import');
  }
  if (!source.includes('return installSingleGlobalSkill(folderPath);')) {
    source = replaceMethod(source, '    async installSkillFromFolder(provider, projectPath, folderPath) {', '    addMcpServer(', `    async installSkillFromFolder(provider, projectPath, folderPath) {
        const control = this.#controls.forProvider(provider);
        if (!control.capabilities.skillsInstall || !control.listSkills) {
            throw new Error('provider "' + provider + '" cannot install skills yet');
        }
        return installSingleGlobalSkill(folderPath);
    }
`, 'global legacy skill install');
  }
  // Global Crab skills are visible to every workspace and provider. Keep the
  // provider's own inventory for capability reporting, then merge the shared
  // inventory and advertise its catalog at session start.
  if (!source.includes("from './carb-global-skills.js'")) {
    const anchor = source.includes("from './carb-skill-install.js'")
      ? /import \{[^}]+\} from '\.\/carb-skill-install\.js';/
      : /import \{ insideSkillFolder, installLocalSkill, sameSkillFolder \} from '\.\/skill-install\.js';/;
    const match = source.match(anchor);
    if (!match) throw new Error('global skill import: installer import not found');
    source = source.replace(match[0], `${match[0]}\nimport { listGlobalSkills, globalSkillCatalog } from './carb-global-skills.js';`);
  }
  source = replaceUnlessPresent(source, '        const bundled = this.#bundledSkills().skills;', '        const bundled = this.#bundledSkills().skills;\n        const global = await listGlobalSkills();', 'const global = await listGlobalSkills();', 'global skill inventory');
  source = replaceUnlessPresent(source,
    '        const local = control.capabilities.agentsSkillsDir\n            ? await listLocalSkills(projectPath)\n            : undefined;',
    '        const local = projectPath && control.capabilities.agentsSkillsDir\n            ? await listLocalSkills(projectPath)\n            : undefined;',
    'const local = projectPath && control.capabilities.agentsSkillsDir',
    'global skill inventory local workspace guard');
  source = replaceUnlessPresent(source,
    '        const global = await listGlobalSkills();\n        if (!control.listSkills) {',
    '        const global = await listGlobalSkills();\n        // A workspace is optional for Crab-wide skills. Provider and local inventories need a cwd, so\n        // return the global catalog directly instead of calling either with an undefined path.\n        if (!projectPath) {\n            return { capabilities: NO_SKILL_CAPABILITIES, skills: mergeSkills(global.skills, bundled), errors: [...global.errors] };\n        }\n        if (!control.listSkills) {',
    'return { capabilities: NO_SKILL_CAPABILITIES, skills: mergeSkills(global.skills, bundled)',
    'global skill inventory without project');
  source = replaceUnlessPresent(source, 'return { ...own, skills: mergeSkills(own.skills, bundled) };', 'return { ...own, skills: mergeSkills(mergeSkills(own.skills, global.skills), bundled), errors: [...own.errors, ...global.errors] };', 'global.skills), bundled)', 'global no-vendor merge');
  source = replaceUnlessPresent(source, 'skills: mergeSkills(mergeSkills(vendor.skills, local?.skills ?? []), bundled),', 'skills: mergeSkills(mergeSkills(mergeSkills(vendor.skills, local?.skills ?? []), global.skills), bundled),', 'global.skills), bundled)', 'global vendor merge');
  source = replaceUnlessPresent(source, 'errors: [...vendor.errors, ...(local?.errors ?? [])],', 'errors: [...vendor.errors, ...(local?.errors ?? []), ...global.errors],', '...global.errors]', 'global vendor errors');
  source = replaceUnlessPresent(source, "const catalog = bundled && !native ? bundled.catalog : '';", "const catalog = [bundled && !native ? bundled.catalog : '', skills ? globalSkillCatalog() : ''].filter(Boolean).join('\\n\\n');", 'skills ? globalSkillCatalog()', 'global session catalog');
  return source;
}

export function patchSkillLocalInstaller(source) {
  if (source.includes('await registerInstalledSkill(destination)')) return source;
  source = replaceOne(source, "import path from 'node:path';", "import path from 'node:path';\nimport { registerInstalledSkill, removeInstalledSkill } from './carb-skill-ownership.js';", 'local skill ownership import');
  source = replaceOne(source, '        await mkdir(destination);', '        await mkdir(destination);\n        await registerInstalledSkill(destination);', 'local skill claim');
  source = replaceOne(source, 'await rm(destination, { recursive: true, force: true });', 'await removeInstalledSkill(destination);', 'local skill failure cleanup');
  return source;
}
