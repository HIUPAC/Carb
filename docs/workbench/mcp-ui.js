import { McpConnection } from './mcp.js';

const $ = id => document.getElementById(id);

function jsonObject(text) {
  let object;
  try { object = JSON.parse(text || '{}'); }
  catch { throw new Error('请输入有效的 JSON 参数。'); }
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('工具参数必须是 JSON 对象。');
  return object;
}

export function setupMcp() {
  const services = new Map();
  let selected;
  let resultGeneration = 0;
  let nextId = 1;
  const status = (id, content = '') => {
    $(id).textContent = content;
    $(id).hidden = !content;
  };

  function render() {
    const rows = [];
    for (const [id, service] of services) {
      const row = document.createElement('div');
      row.className = 'mcp-service';
      const select = document.createElement('button');
      select.type = 'button';
      select.textContent = service.name + ' · ' + service.tools.length + ' 个工具';
      select.title = service.name;
      select.setAttribute('aria-pressed', id === selected);
      select.onclick = () => {
        selected = id;
        resultGeneration++;
        render();
      };
      const disconnect = document.createElement('button');
      disconnect.type = 'button';
      disconnect.textContent = '断开';
      disconnect.setAttribute('aria-label', '断开 ' + service.name);
      disconnect.onclick = () => {
        services.delete(id);
        service.connection.close().catch(() => {});
        if (selected === id) selected = services.keys().next().value;
        resultGeneration++;
        render();
        status('mcp-status', '已断开服务。');
      };
      row.append(select, disconnect);
      rows.push(row);
    }
    $('mcp-services').replaceChildren(...rows);
    const current = services.get(selected);
    $('mcp-test').hidden = !current?.tools.length;
    $('mcp-tool').replaceChildren(...(current?.tools || []).map(tool => new Option(tool.title || tool.name, tool.name)));
    $('mcp-arguments').value = '{}';
    status('mcp-result');
  }

  $('mcp').onclick = () => $('mcp-dialog').showModal();
  $('mcp-form').onsubmit = async event => {
    event.preventDefault();
    if ($('mcp-connect').disabled) return;
    $('mcp-connect').disabled = true;
    status('mcp-error');
    status('mcp-status', '正在连接…');
    let connection;
    try {
      if (services.size >= 6) throw new Error('一个页面最多连接六个 MCP 服务。');
      const url = $('mcp-url').value.trim();
      const token = $('mcp-token').value;
      $('mcp-token').value = '';
      connection = new McpConnection({ url, token });
      const { serverInfo, tools } = await connection.connect();
      const id = nextId++;
      const name = typeof serverInfo?.name === 'string' ? serverInfo.name.slice(0, 100) : new URL(url).hostname;
      services.set(id, { id, name, connection, tools });
      selected = id;
      resultGeneration++;
      render();
      status('mcp-status', tools.length ? '服务已连接。' : '服务已连接，目前未提供工具。');
    } catch (error) {
      if (connection) connection.close().catch(() => {});
      status('mcp-error', error.message);
      status('mcp-status');
    } finally { $('mcp-connect').disabled = false; }
  };

  $('mcp-test').onsubmit = async event => {
    event.preventDefault();
    const service = services.get(selected);
    if (!service || $('mcp-call').disabled) return;
    const generation = ++resultGeneration;
    $('mcp-call').disabled = true;
    status('mcp-error');
    status('mcp-result', '正在调用…');
    try {
      const result = await service.connection.callTool($('mcp-tool').value, jsonObject($('mcp-arguments').value));
      if (generation === resultGeneration) status('mcp-result', JSON.stringify(result, null, 2).slice(0, 64000));
    } catch (error) {
      if (generation === resultGeneration) {
        status('mcp-error', error.message);
        status('mcp-result');
      }
    } finally { $('mcp-call').disabled = false; }
  };

  function approval(service, tool, args, signal) {
    signal.throwIfAborted();
    const dialog = $('mcp-approval');
    $('mcp-approval-name').textContent = service.name + ' / ' + tool.name;
    $('mcp-approval-args').textContent = JSON.stringify(args, null, 2);
    dialog.returnValue = '';
    return new Promise(resolve => {
      const abort = () => { if (dialog.open) dialog.close('deny'); };
      dialog.addEventListener('close', () => {
        signal.removeEventListener('abort', abort);
        resolve(dialog.returnValue === 'allow' && !signal.aborted);
      }, { once: true });
      dialog.showModal();
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  function modelTools() {
    const selectedTools = [];
    for (const service of services.values()) {
      for (const [index, tool] of service.tools.entries()) {
        if (selectedTools.length >= 40) return selectedTools;
        const safeName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 38);
        const settings = {
          name: 'mcp_' + service.id + '_' + (index + 1) + '_' + safeName,
          description: (service.name + ' / ' + tool.name + '：' + (tool.description || '')).slice(0, 900),
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        };
        selectedTools.push({ settings, async call(input, signal) {
          const args = jsonObject(input);
          if (!await approval(service, tool, args, signal)) return { content: '用户未授权执行这次 MCP 工具调用。', label: '未授权 · ' + tool.name };
          if (!services.has(service.id)) throw new Error('MCP 服务已断开。');
          const result = await service.connection.callTool(tool.name, args, signal);
          const output = result.structuredContent ?? result.content?.map(item => item.type === 'text' ? item.text : '[' + item.type + ']') ?? [];
          return { content: JSON.stringify(output).slice(0, 28000), label: (result.isError ? 'MCP 调用返回错误 · ' : '已调用 MCP · ') + tool.name };
        } });
      }
    }
    return selectedTools;
  }

  return { modelTools };
}
