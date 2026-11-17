import { replaceOnce } from './prepare-brand.mjs';

// Limit each submitted turn (the internal design marker is not a file).
export function patchAttachmentServer(source) {
  return replaceOnce(source, "            case 'thread.sendTurn': {\n                const p = parseParams(method, params);", `            case 'thread.sendTurn': {
                const p = parseParams(method, params);
                if ((p.attachments ?? []).filter(file => file !== 'carb://design-brief-v1' && file !== 'personal-harness://design-brief-v1').length > 15)
                    throw new Error('每次最多添加 15 个文件。');`);
}

// Only explicitly attached files are readable outside the workspace. Other
// workspace operations keep their original confinement and approval checks.
export function patchAttachmentApi(source) {
  source = replaceOnce(source, '    this.workspacePath = workspacePath;', '    this.workspacePath = workspacePath;\n    this.attachedFiles = new Set();');
  source = replaceOnce(source, '    this.messages.push(makeUserMessage(text, attachments));', `    for (const file of attachments) {
      if (typeof file === 'string' && path.isAbsolute(file)) this.attachedFiles.add(path.resolve(file));
    }
    this.messages.push(makeUserMessage(text, attachments));`);
  source = replaceOnce(source, "description: 'Read UTF-8 text inside the active workspace. Large files can be read in pages using start_line and start_column (both 1-based). The result provides the cursor for the next page.'", "description: 'Read UTF-8 text inside the active workspace or an explicitly attached file. Large files can be read in pages using start_line and start_column (both 1-based). The result provides the cursor for the next page.'");
  return replaceOnce(source, '        const absolute = await resolveWorkspacePath(this.workspacePath, args.path);\n        const content = await readTextFile(absolute, signal);', `        let absolute;
        const selected = typeof args.path === 'string' && path.isAbsolute(args.path) ? path.resolve(args.path) : undefined;
        if (selected && this.attachedFiles.has(selected)) {
          const info = await lstat(selected);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error('Only regular attached files without links can be read.');
          absolute = selected;
        } else {
          absolute = await resolveWorkspacePath(this.workspacePath, args.path);
        }
        const content = await readTextFile(absolute, signal);`);
}
