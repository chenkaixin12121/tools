/* 开发者工具箱的所有处理均在浏览器本地完成。 */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// 每个工具激活时的初始化动作。
const toolInitializers = {
  cron: parseCron,
  timestamp: () => !$('#timestamp-input').value && setTimestampNow(),
  regex: runRegex,
  markdown: renderMarkdown,
  jwt: decodeJwt,
  password: () => $('#password-output').classList.contains('placeholder-output') && generatePassword()
};

/** 应用并持久化主题。 */
function applyTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  $('#theme-toggle').innerHTML = `<i data-lucide="${light ? 'moon' : 'sun'}"></i>`;
  refreshIcons();
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Safari 无痕模式等场景下 localStorage 不可用，静默忽略。
  }
}

/**
 * 只为指定范围内尚未渲染的占位元素创建图标。
 * 注意：lucide createIcons() 始终扫描全文档，无法限定范围。
 * 真正的优化在于减少调用次数（如 setJsonStatus 改成只更新文本，不重建 innerHTML）。
 */
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

/** 输入类操作的防抖，避免每次按键都触发全量解析与重渲染。 */
function debounce(handler, delay = 300) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => handler(...args), delay);
  };
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}

/**
 * 写入输出内容。placeholder 显式声明这次写入的是占位文案，
 * 避免调用方在传占位文本后还要手动补 placeholder-output 类。
 */
function setOutput(element, value, placeholder = false) {
  element.textContent = value;
  element.classList.toggle('placeholder-output', placeholder || !value);
}

async function copyText(id) {
  const element = $(id.startsWith('#') ? id : `#${id}`);
  const value = element.dataset.copyValue ?? (element.value !== undefined ? element.value : element.textContent);
  if (!value || element.classList.contains('placeholder-output')) {
    showToast('没有可复制的内容');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast('已复制到剪贴板');
  } catch {
    showToast('复制失败，请手动选择内容');
  }
}

function activateTool(hash) {
  const id = hash.replace('#', '') || 'json';
  const panel = document.getElementById(id);
  if (!panel || !panel.classList.contains('tool-panel')) return;
  $$('.tool-panel').forEach((item) => {
    item.hidden = item !== panel;
    item.classList.toggle('is-active', item === panel);
  });
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.tool === id));
  $('#tool-title').textContent = panel.dataset.title;
  toolInitializers[id]?.();
}

// 支持全屏编辑的面板 ID 列表，按钮 ID 约定为 `${id}-fullscreen`
const FULLSCREEN_PANELS = ['json', 'markdown'];

// 同步单个面板的全屏按钮文案与图标
function syncFullscreenButton(panelId) {
  const button = $(`#${panelId}-fullscreen`);
  if (!button) return;
  const active = document.fullscreenElement === $(`#${panelId}`);
  button.setAttribute('aria-pressed', String(active));
  button.innerHTML = `<i data-lucide="${active ? 'minimize' : 'maximize'}"></i>${active ? '退出全屏' : '全屏编辑'}`;
}

// 全屏状态变化时统一刷新所有按钮，避免遗漏残留状态
function syncAllFullscreenButtons() {
  FULLSCREEN_PANELS.forEach(syncFullscreenButton);
  refreshIcons();
}

async function togglePanelFullscreen(panelId) {
  const panel = $(`#${panelId}`);
  if (!panel) return;
  try {
    if (document.fullscreenElement === panel) await document.exitFullscreen();
    else await panel.requestFullscreen();
  } catch {
    showToast('当前浏览器无法进入全屏模式');
  }
}

function setJsonStatus(style, icon, message) {
  const status = $('#json-status');
  status.className = `validation-state ${style}`;
  // 只在图标变化时才重建 innerHTML 并触发全局图标刷新。
  let label = status.querySelector('span');
  if (status.dataset.icon !== icon || !label) {
    status.innerHTML = `<i data-lucide="${icon}"></i><span></span>`;
    status.dataset.icon = icon;
    label = status.querySelector('span');
    refreshIcons();
  }
  label.textContent = message;
}

function showJsonText(value, placeholder = false) {
  const output = $('#json-output');
  output.textContent = value;
  output.classList.remove('tree-view');
  output.classList.toggle('placeholder-output', placeholder);
  delete output.dataset.copyValue;
  setJsonExpandAllState(false);
}

function refreshJsonOutput() {
  const input = $('#json-input').value.trim();
  if (!input) {
    showJsonText('处理结果将根据左侧内容实时显示', true);
    setJsonMetrics('');
    setJsonStatus('neutral', 'info', '等待输入');
    return;
  }
  // 处理结果固定以树结构展示。
  showJsonTree();
}

/** 输入是否为合法 JSON，仅用于给出提示，不作为转义操作的前置条件。 */
function isValidJson(text) {
  try { JSON.parse(text); return true; } catch { return false; }
}

/**
 * 转义任意文本，不要求输入是合法 JSON。
 * 常见用途是把 SQL、日志、HTML 片段塞进 JSON 字符串字段里。
 * 借 JSON.stringify 完成转义再去掉两端引号，控制字符（\b \f 及 \u0000-\u001F）
 * 都能按规范处理，比手写 replace 链完整。
 */
function escapeJson() {
  const input = $('#json-input').value;
  if (!input) { setJsonStatus('neutral', 'info', '等待输入'); showToast('先在左侧输入要转义的内容'); return; }
  $('#json-input').value = JSON.stringify(input).slice(1, -1);
  updateJsonCount();
  showToast('已添加转义');
}

function decodeJsonEscapes(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, token) => {
    if (token.startsWith('u')) return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    return ({ '"':'"', '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t' })[token];
  });
}

/**
 * 去除转义，同样不要求结果是合法 JSON。
 * 输入若是带引号包裹的完整字符串字面量，优先交给 JSON.parse 处理；
 * 否则按逐个转义序列解码，未识别的序列原样保留。
 */
function unescapeJson() {
  const input = $('#json-input').value.trim();
  if (!input) { setJsonStatus('neutral', 'info', '等待输入'); showToast('先在左侧粘贴转义后的字符串'); return; }
  let result = decodeJsonEscapes(input);
  try {
    const wrapped = JSON.parse(input);
    if (typeof wrapped === 'string') result = wrapped;
  } catch { /* 输入未用引号包裹，走上面的逐序列解码。 */ }
  $('#json-input').value = result;
  updateJsonCount();
  showToast(isValidJson(result) ? '已还原，结果是合法 JSON' : '已去除转义');
}

function minifyJsonInput() {
  const input = $('#json-input');
  if (!input.value.trim()) { setJsonStatus('neutral', 'info', '等待输入'); showToast('先在左侧输入 JSON'); return; }
  try {
    input.value = JSON.stringify(JSON.parse(input.value));
    updateJsonCount();
    showToast('已压缩左侧 JSON');
  } catch (error) {
    setJsonStatus('error', 'circle-x', '格式有误');
    showToast('格式有误，无法压缩');
  }
}

// 树视图的性能护栏：超过该深度默认折叠，单层每批最多渲染这么多条。
const TREE_AUTO_COLLAPSE_DEPTH = 2;
const TREE_CHUNK_SIZE = 100;
// 一键全展开时最多生成这么多节点，超出后停止并提示，避免大 JSON 卡死页面。
const TREE_EXPAND_ALL_LIMIT = 20000;

/**
 * 记录每个分支节点的折叠开关，供「全展开 / 全折叠」复用。
 * 用 WeakMap 是因为重新解析时整棵树会被替换，键随 DOM 一起回收。
 */
const treeBranchControls = new WeakMap();

/** 按批次把子节点挂到容器上，返回继续渲染下一批的函数。 */
function appendTreeChildren(container, entries, depth) {
  let rendered = 0;
  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'tree-more';
  const renderChunk = () => {
    const slice = entries.slice(rendered, rendered + TREE_CHUNK_SIZE);
    const fragment = document.createDocumentFragment();
    slice.forEach(([childKey, child]) => fragment.append(createJsonTreeNode(childKey, child, depth + 1)));
    container.insertBefore(fragment, moreButton.isConnected ? moreButton : null);
    rendered += slice.length;
    const remaining = entries.length - rendered;
    if (remaining > 0) {
      moreButton.textContent = `还有 ${remaining} 项，点击加载`;
      if (!moreButton.isConnected) container.append(moreButton);
    } else {
      moreButton.remove();
    }
  };
  moreButton.addEventListener('click', renderChunk);
  return renderChunk;
}

function createJsonTreeNode(key, value, depth = 0) {
  const node = document.createElement('div');
  node.className = 'tree-node';
  const line = document.createElement('div');
  line.className = 'tree-line';
  const isBranch = value !== null && typeof value === 'object';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `tree-toggle${isBranch ? '' : ' leaf'}`;
  toggle.textContent = isBranch ? '▾' : '·';
  if (!isBranch) toggle.setAttribute('aria-hidden', 'true');
  line.append(toggle);
  if (key !== null) {
    const keyLabel = document.createElement('span');
    keyLabel.className = 'tree-key';
    keyLabel.textContent = `${key}:`;
    line.append(keyLabel);
  }
  if (isBranch) {
    // entries 只计算一次，数组与对象统一成 [key, value] 结构。
    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((item, index) => [`[${index}]`, item]) : Object.entries(value);
    const summary = document.createElement('span');
    summary.className = 'tree-summary';
    summary.textContent = `${isArray ? 'Array' : 'Object'}(${entries.length})`;
    line.append(summary);
    const children = document.createElement('div');
    children.className = 'tree-children';
    const renderChunk = appendTreeChildren(children, entries, depth);
    // 深层节点默认折叠，且折叠状态下不创建子 DOM，避免大 JSON 一次性生成数万节点。
    let built = false;
    const ensureBuilt = () => { if (!built) { built = true; renderChunk(); } };
    const startCollapsed = depth >= TREE_AUTO_COLLAPSE_DEPTH && entries.length > 0;
    if (startCollapsed) node.classList.add('collapsed');
    else ensureBuilt();
    toggle.textContent = startCollapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!startCollapsed));
    toggle.setAttribute('aria-label', key === null ? '根节点' : `${key} 展开或折叠`);
    // 折叠态只改 class，展开时才补建子 DOM，全展开与单击共用这一段逻辑。
    const setCollapsed = (collapsed) => {
      node.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      if (!collapsed) ensureBuilt();
    };
    treeBranchControls.set(node, setCollapsed);
    toggle.addEventListener('click', () => setCollapsed(!node.classList.contains('collapsed')));
    node.append(line, children);
  } else {
    const valueLabel = document.createElement('span');
    const kind = value === null ? 'null' : typeof value;
    valueLabel.className = `tree-value ${kind}`;
    valueLabel.textContent = typeof value === 'string' ? `"${value}"` : String(value);
    line.append(valueLabel);
    node.append(line);
  }
  return node;
}

/** 统计节点总数与最大深度，供状态行展示。 */
function measureJson(value, depth = 1) {
  if (value === null || typeof value !== 'object') return { nodes: 1, depth };
  const children = Array.isArray(value) ? value : Object.values(value);
  let nodes = 1;
  let maxDepth = depth;
  for (const child of children) {
    const stat = measureJson(child, depth + 1);
    nodes += stat.nodes;
    if (stat.depth > maxDepth) maxDepth = stat.depth;
  }
  return { nodes, depth: maxDepth };
}

function setJsonMetrics(text) {
  $('#json-metrics').innerHTML = text;
}

/** 同步全展开按钮的可用状态与文案；树视图之外一律禁用。 */
function setJsonExpandAllState(enabled, expanded = false) {
  const button = $('#json-expand-all');
  button.disabled = !enabled;
  button.setAttribute('aria-pressed', String(enabled && expanded));
  button.textContent = enabled && expanded ? '全折叠' : '全展开';
}

/**
 * 逐轮展开所有折叠节点：展开会补建子 DOM，新子节点里可能还有折叠项，
 * 所以要循环到没有折叠节点为止，同时顺带点掉「还有 N 项」的分批按钮。
 */
function expandAllJsonNodes() {
  const output = $('#json-output');
  // live 集合，展开过程中 length 会自动增长，用来卡住节点总数上限。
  const allNodes = output.getElementsByClassName('tree-node');
  let truncated = false;
  while (true) {
    if (allNodes.length > TREE_EXPAND_ALL_LIMIT) { truncated = true; break; }
    const pending = output.querySelectorAll('.tree-node.collapsed, .tree-more');
    if (!pending.length) break;
    let handled = 0;
    pending.forEach((element) => {
      if (element.classList.contains('tree-more')) { element.click(); handled += 1; return; }
      const setCollapsed = treeBranchControls.get(element);
      if (setCollapsed) { setCollapsed(false); handled += 1; }
    });
    // 理论上不会发生：仍有折叠节点却一个都处理不了时直接退出，避免死循环。
    if (!handled) break;
  }
  setJsonExpandAllState(true, !truncated);
  if (truncated) showToast(`节点过多，已展开前 ${TREE_EXPAND_ALL_LIMIT} 个，其余请手动展开`);
}

/**
 * 折叠所有分支节点，但保留根节点展开：全折叠后至少还能看到第一层键名，
 * 否则整棵树只剩一行，用户失去定位上下文。
 */
function collapseAllJsonNodes() {
  const output = $('#json-output');
  const root = output.firstElementChild;
  if (!root) { setJsonExpandAllState(true, false); return; }
  // 先展开根节点：折叠态的根没有子 DOM，展开会补建出默认展开的第二层，
  // 所以必须先补建、再统一折叠，顺序反了会残留两层。
  treeBranchControls.get(root)?.(false);
  output.querySelectorAll('.tree-node:not(.collapsed)').forEach((node) => {
    if (node === root) return;
    treeBranchControls.get(node)?.(true);
  });
  setJsonExpandAllState(true, false);
}

function showJsonTree() {
  const input = $('#json-input').value.trim();
  if (!input) { setJsonStatus('neutral', 'info', '等待输入'); return; }
  try {
    const parsed = JSON.parse(input);
    const output = $('#json-output');
    output.replaceChildren(createJsonTreeNode(null, parsed));
    output.classList.remove('placeholder-output');
    output.classList.add('tree-view');
    output.dataset.copyValue = JSON.stringify(parsed, null, 2);
    const { nodes, depth } = measureJson(parsed);
    setJsonMetrics(`<span>nodes <b>${nodes}</b></span><span>depth <b>${depth}</b></span><span>chars <b>${input.length}</b></span>`);
    setJsonStatus('success', 'circle-check', '格式正确');
    // 纯标量（数字、字符串等）没有可展开的分支，按钮保持禁用。
    setJsonExpandAllState(parsed !== null && typeof parsed === 'object');
  } catch (error) {
    setJsonMetrics('');
    // 以 { [ " 开头视为「本想写 JSON 但写错了」，红字提示具体错误；
    // 其余内容（转义结果、SQL、日志等）只是不是 JSON，不算出错。
    if (/^[{["]/.test(input)) {
      showJsonText(`解析失败：${error.message}`);
      setJsonStatus('error', 'circle-x', '格式有误');
    } else {
      showJsonText('当前内容不是 JSON，树视图不可用。转义与去转义仍可正常使用。', true);
      setJsonStatus('neutral', 'info', '非 JSON 文本');
    }
  }
}

/** 字符数需要即时反馈，与防抖的输出刷新分开。 */
function updateJsonCharCount() {
  $('#json-count').textContent = `${$('#json-input').value.length} 字符`;
}

function updateJsonCount() {
  updateJsonCharCount();
  refreshJsonOutput();
}


const unixCronFields = ['minute', 'hour', 'day', 'month', 'week'];
const springCronFields = ['second', 'minute', 'hour', 'day', 'month', 'week', 'year'];
const cronNames = {
  second: '秒', minute: '分钟', hour: '小时', day: '日期', month: '月份', week: '星期', year: '年份',
};
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
const ranges = { second:[0,59], minute:[0,59], hour:[0,23], day:[1,31], month:[1,12], week:[0,7], year:[1970,2199] };
const monthAliases = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const weekAliases = { SUN:0, MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6 };

function normalizeCronPart(part, field) {
  const aliases = field === 'month' ? monthAliases : field === 'week' ? weekAliases : null;
  if (!aliases) return part;
  return part.toUpperCase().replace(/[A-Z]{3}/g, (name) => aliases[name] ?? name);
}

function parsePart(part, min, max) {
  const values = new Set();
  const addRange = (from, to, step = 1) => {
    for (let value = from; value <= to; value += step) values.add(value);
  };
  for (const segment of part.split(',')) {
    if (segment === '?') { addRange(min, max); continue; }
    const [base, stepText] = segment.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error('步长无效');
    if (base === '*') addRange(min, max, step);
    else if (base.includes('-')) {
      const [from, to] = base.split('-').map(Number);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) throw new Error('范围无效');
      addRange(from, to, step);
    } else {
      const value = Number(base);
      if (!Number.isInteger(value) || value < min || value > max) throw new Error('数值超出范围');
      values.add(value);
    }
  }
  return values;
}

function describePart(value, label) {
  if (value === '*' || value === '?') return value === '?' ? '不指定' : `每${label}`;
  if (/^\*\/\d+$/.test(value)) return `每 ${value.slice(2)} ${label}`;
  if (label === '星期') {
    if (/^\d$/.test(value)) return `星期${weekDays[Number(value) % 7]}`;
    if (/^\d-\d$/.test(value)) { const [a,b] = value.split('-').map(Number); return `星期${weekDays[a % 7]}至${weekDays[b % 7]}`; }
  }
  return value.replaceAll(',', '、');
}

function humanCron(parts, isSpring) {
  if (isSpring) {
    const [second, minute, hour, day, month, week] = parts;
    if (second === '0' && /^\*\/\d+$/.test(hour) && /^\d+$/.test(minute) && day === '*' && month === '*' && week === '?') {
      return `每 ${hour.slice(2)} 小时的第 ${minute} 分执行（从 00:${minute.padStart(2, '0')} 开始）`;
    }
    return `${describePart(month, '月份')}的${describePart(day, '日期')}，${describePart(week, '星期')}，在${describePart(hour, '小时')} ${describePart(minute, '分钟')} ${describePart(second, '秒')}执行`;
  }
  const [minute, hour, day, month, week] = parts;
  if (day === '*' && month === '*' && week === '1-5') return `每周一至周五的 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 执行`;
  if (day === '*' && month === '*' && week === '*') return `每天 ${hour === '*' ? '每小时' : hour.padStart(2, '0') + ':' + minute.padStart(2, '0')} 执行`;
  return `${describePart(month, '月份')}，${describePart(day, '日期')}，${describePart(week, '星期')}，${describePart(hour, '小时')} ${describePart(minute, '分钟')}执行`;
}

// 展示时区必须与 nextRuns 的计算时区保持一致，否则非东八区用户会看到错位的执行时间。
function formatDate(date) {
  const full = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday:'long' }).format(date);
  return `${full.replaceAll('/', '-')} ${weekday}`;
}

function nextRuns(values, isSpring) {
  const seconds = isSpring ? values.second : new Set([0]);
  const years = isSpring && values.year ? values.year : null;
  // 避免修改传入的 Set（副作用），复制一份后再操作。
  const week = new Set(values.week);
  if (week.has(7)) week.add(0);

  // 早退机制：检测日期与月份的不可能组合（如 2 月 30 日）。
  const maxDaysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let anyPossibleDate = false;
  for (const month of values.month) {
    const maxDay = maxDaysInMonth[month - 1];
    for (const day of values.day) {
      if (day <= maxDay) { anyPossibleDate = true; break; }
    }
    if (anyPossibleDate) break;
  }
  if (!anyPossibleDate) return [];

  const result = [];
  const now = new Date();
  now.setMilliseconds(0);
  now.setSeconds(now.getSeconds() + 1);
  const date = new Date(now);
  date.setSeconds(0, 0);
  const sortedSeconds = [...seconds].sort((a, b) => a - b);
  // Cron 采用本机本地时间，展示也用本机时区，两者保持一致。
  for (let count = 0; count < 525960 && result.length < 5; count += 1) {
    const match = values.minute.has(date.getMinutes()) && values.hour.has(date.getHours()) && values.day.has(date.getDate()) && values.month.has(date.getMonth() + 1) && week.has(date.getDay()) && (!years || years.has(date.getFullYear()));
    if (match) {
      for (const second of sortedSeconds) {
        const candidate = new Date(date);
        candidate.setSeconds(second, 0);
        if (candidate >= now) result.push(candidate);
        if (result.length === 5) break;
      }
    }
    date.setMinutes(date.getMinutes() + 1);
  }
  return result;
}

function parseCron() {
  const rawInput = $('#cron-input').value.trim();
  const list = $('#cron-runs');
  try {
    const annotation = rawInput.match(/cron\s*=\s*["']([^"']+)["']/i);
    const raw = (annotation ? annotation[1] : rawInput).replace(/^["']|["']$/g, '');
    const parts = raw.split(/\s+/);
    const isSpring = parts.length === 6 || parts.length === 7;
    if (!isSpring && parts.length !== 5) throw new Error('请输入五段 Unix Cron 或六、七段 Spring Cron');
    const fieldKeys = isSpring ? springCronFields.slice(0, parts.length) : unixCronFields;
    const values = {};
    const normalizedParts = parts.map((part, index) => normalizeCronPart(part, fieldKeys[index]));
    normalizedParts.forEach((part, index) => { values[fieldKeys[index]] = parsePart(part, ...ranges[fieldKeys[index]]); });
    // 展示本机真实时区，与 nextRuns 的计算基准一致。
    $('#cron-timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时区';
    $('#cron-human').textContent = humanCron(parts, isSpring);
    $('#cron-fields').innerHTML = parts.map((part, index) => `<div class="cron-field"><span>${cronNames[fieldKeys[index]]}</span><b>${part}</b><p>${describePart(part, cronNames[fieldKeys[index]])}</p></div>`).join('');
    const runs = nextRuns(values, isSpring);
    list.innerHTML = runs.length ? runs.map((run) => `<li>${formatDate(run)}</li>`).join('') : '<li>未来一年内没有匹配的执行时间</li>';
  } catch (error) {
    $('#cron-human').textContent = `无法解析：${error.message}`;
    $('#cron-fields').innerHTML = '';
    list.innerHTML = '<li>请检查表达式格式与字段范围</li>';
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateTimeLocalValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function setTimestampNow() {
  const now = new Date();
  $('#timestamp-input').value = String(now.getTime());
  $('#timestamp-unit').value = 'ms';
  $('#date-input').value = toDateTimeLocalValue(now);
  convertTimestampToDate();
  convertDateToTimestamp();
}

function convertTimestampToDate() {
  const raw = $('#timestamp-input').value.trim();
  const result = $('#timestamp-date-result strong');
  const timestamp = Number(raw) * ($('#timestamp-unit').value === 's' ? 1000 : 1);
  if (!raw || !Number.isFinite(timestamp)) {
    result.textContent = '请输入有效的数字时间戳';
    return;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) { result.textContent = '时间戳超出日期范围'; return; }
  result.textContent = formatLocalDate(date);
  $('#date-input').value = toDateTimeLocalValue(date);
}

function convertDateToTimestamp() {
  const raw = $('#date-input').value;
  const timestamp = new Date(raw).getTime();
  if (!raw || Number.isNaN(timestamp)) {
    $('#timestamp-ms-result').textContent = '请选择有效日期时间';
    $('#timestamp-s-result').textContent = '秒：--';
    return;
  }
  $('#timestamp-ms-result').textContent = String(timestamp);
  $('#timestamp-s-result').textContent = `秒：${Math.floor(timestamp / 1000)}`;
  $('#timestamp-input').value = String(timestamp);
  $('#timestamp-unit').value = 'ms';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[character]));
}

function runRegex() {
  const pattern = $('#regex-pattern').value;
  const text = $('#regex-text').value;
  const selectedFlags = $$('.regex-flag:checked').map((item) => item.value).join('');
  const flags = selectedFlags.includes('g') ? selectedFlags : `${selectedFlags}g`;
  const output = $('#regex-output');
  try {
    const expression = new RegExp(pattern, flags);
    const matches = [...text.matchAll(expression)].slice(0, 100);
    $('#regex-count').textContent = `${matches.length}${matches.length === 100 ? '+' : ''} 个匹配`;
    output.innerHTML = matches.length
      ? matches.map((match, index) => `<div class="match-item"><span class="match-index">#${index + 1} @ ${match.index}</span><span class="match-value">${escapeHtml(match[0] || '(空匹配)')}</span></div>`).join('')
      : '<p class="match-empty">没有匹配结果</p>';
  } catch (error) {
    $('#regex-count').textContent = '表达式错误';
    output.innerHTML = `<p class="match-empty">${escapeHtml(error.message)}</p>`;
  }
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/** 与 JSON 一致：字符数即时更新，预览渲染走防抖。 */
function updateMarkdownCharCount() {
  $('#markdown-count').textContent = `${$('#markdown-input').value.length} 字符`;
}

function renderMarkdown() {
  const source = $('#markdown-input').value;
  const output = $('#markdown-output');
  updateMarkdownCharCount();
  if (!source.trim()) {
    setOutput(output, '预览内容将显示在这里', true);
    return;
  }
  output.classList.remove('placeholder-output');
  const lines = source.replaceAll('\r', '').split('\n');
  let html = '';
  let listType = null;
  let inCode = false;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const line of lines) {
    if (line.startsWith('```')) { closeList(); html += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue; }
    if (inCode) { html += `${escapeHtml(line)}\n`; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`; }
    else if (unordered) { if (listType !== 'ul') { closeList(); listType = 'ul'; html += '<ul>'; } html += `<li>${inlineMarkdown(unordered[1])}</li>`; }
    else if (ordered) { if (listType !== 'ol') { closeList(); listType = 'ol'; html += '<ol>'; } html += `<li>${inlineMarkdown(ordered[1])}</li>`; }
    else if (line.startsWith('> ')) { closeList(); html += `<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`; }
    else if (/^---+$/.test(line)) { closeList(); html += '<hr>'; }
    else if (!line.trim()) { closeList(); }
    else { closeList(); html += `<p>${inlineMarkdown(line)}</p>`; }
  }
  closeList();
  if (inCode) html += '</code></pre>';
  output.innerHTML = html;
}

/**
 * 示例覆盖渲染器支持的全部语法：三级标题、有序无序列表、粗体斜体、
 * 行内代码、链接、引用、代码块、分隔线。改渲染逻辑时可拿它当回归用例。
 */
const MARKDOWN_SAMPLE = [
  '# 用户接口联调记录',
  '',
  '## 待确认',
  '',
  '1. 分页参数用 `page` 还是 `offset`',
  '2. 错误码是否统一收在 `code` 字段',
  '',
  '## 已确认',
  '',
  '- 时间戳统一用**毫秒**，不混用秒',
  '- 空列表返回 `[]`，*不要* 返回 `null`',
  '- 错误响应体参照 [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)',
  '',
  '### 分页上限',
  '',
  '> 单页最多 100 条，超过按 100 截断，不报错。',
  '',
  '```',
  'GET /api/users?page=1&size=20',
  '```',
  '',
  '---',
  '',
  '改完同步给前端，顺手更新一下接口文档。',
].join('\n');

function loadMarkdownSample() {
  $('#markdown-input').value = MARKDOWN_SAMPLE;
  renderMarkdown();
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function decodeJwt() {
  const token = $('#jwt-input').value.trim().replace(/^Bearer\s+/i, '');
  const status = $('#jwt-status');
  const details = $('#jwt-details');
  if (!token) {
    setOutput($('#jwt-header'), 'Header 将显示在这里', true);
    setOutput($('#jwt-payload'), 'Payload 将显示在这里', true);
    status.textContent = '等待输入';
    details.hidden = true;
    return;
  }
  try {
    const parts = token.split('.');
    if (parts.length < 2) throw new Error('Token 需要包含 Header 和 Payload');
    const header = JSON.parse(decodeBase64Url(parts[0]));
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    setOutput($('#jwt-header'), JSON.stringify(header, null, 2));
    setOutput($('#jwt-payload'), JSON.stringify(payload, null, 2));
    status.textContent = '解码成功，未验证签名';
    const detailItems = [];
    if (payload.iss) detailItems.push(`签发者 <b>${escapeHtml(payload.iss)}</b>`);
    if (payload.sub) detailItems.push(`主体 <b>${escapeHtml(payload.sub)}</b>`);
    if (payload.exp) detailItems.push(`过期时间 <b>${formatLocalDate(new Date(payload.exp * 1000))}</b>`);
    if (payload.iat) detailItems.push(`签发时间 <b>${formatLocalDate(new Date(payload.iat * 1000))}</b>`);
    details.innerHTML = detailItems.map((item) => `<span class="jwt-detail">${item}</span>`).join('');
    details.hidden = !detailItems.length;
  } catch (error) {
    setOutput($('#jwt-header'), '无法解析 Token');
    setOutput($('#jwt-payload'), error.message);
    status.textContent = 'JWT 格式无效';
    details.hidden = true;
  }
}

function secureRandomIndex(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % max;
}

function createSecurePassword(groups, length) {
  const pool = groups.join('');
  const password = groups.map((group) => group[secureRandomIndex(group.length)]);
  while (password.length < length) password.push(pool[secureRandomIndex(pool.length)]);
  for (let index = password.length - 1; index > 0; index -= 1) {
    const target = secureRandomIndex(index + 1);
    [password[index], password[target]] = [password[target], password[index]];
  }
  return password.join('');
}

function generatePassword() {
  const groups = [
    $('#password-lower').checked ? 'abcdefghijkmnopqrstuvwxyz' : '',
    $('#password-upper').checked ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '',
    $('#password-number').checked ? '23456789' : '',
    $('#password-symbol').checked ? '!@#$%^&*_-+=' : '',
  ].filter(Boolean);
  if (!groups.length) { showToast('请至少选择一种字符类型'); return; }
  const length = Number($('#password-length').value);
  const countInput = $('#password-count');
  const count = Math.min(20, Math.max(1, Number.parseInt(countInput.value, 10) || 1));
  countInput.value = String(count);
  const passwords = Array.from({ length: count }, () => createSecurePassword(groups, length));
  $('#password-output').textContent = passwords.join('\n');
  $('#password-output').classList.remove('placeholder-output');
  showToast(`已生成 ${count} 个随机密码`);
}

function togglePassword() {
  const input = $('#bcrypt-password');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggle-password').setAttribute('aria-label', input.type === 'password' ? '显示文本' : '隐藏文本');
  $('#toggle-password').innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
  refreshIcons();
}

async function generateBcrypt() {
  const password = $('#bcrypt-password').value;
  const rounds = Number($('#bcrypt-rounds').value);
  if (!password) { showToast('请先输入需要加密的内容'); return; }
  if (!window.dcodeIO?.bcrypt) { showToast('bcrypt 库加载失败，请检查网络后重试'); return; }
  const button = $('#bcrypt-generate');
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle"></i>正在生成...';
  refreshIcons();
  window.setTimeout(() => {
    try {
      const hash = window.dcodeIO.bcrypt.hashSync(password, rounds);
      setOutput($('#bcrypt-output'), hash);
      $('#hash-length').textContent = hash.length;
      showToast('bcrypt 哈希已生成');
    } catch { showToast('生成失败，请重试'); }
    button.disabled = false;
    button.innerHTML = '<i data-lucide="key-round"></i>生成 bcrypt 哈希';
    refreshIcons();
  }, 20);
}

function toPem(buffer, label) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----`;
}

async function generateRsa() {
  if (!window.crypto?.subtle) { showToast('当前浏览器不支持 Web Crypto API'); return; }
  const button = $('#rsa-generate');
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle"></i>正在生成...';
  refreshIcons();
  try {
    const keyPair = await crypto.subtle.generateKey({ name:'RSA-OAEP', modulusLength:Number($('#rsa-bits').value), publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' }, true, ['encrypt', 'decrypt']);
    const [publicKey, privateKey] = await Promise.all([crypto.subtle.exportKey('spki', keyPair.publicKey), crypto.subtle.exportKey('pkcs8', keyPair.privateKey)]);
    $('#rsa-public').value = toPem(publicKey, 'PUBLIC KEY');
    $('#rsa-private').value = toPem(privateKey, 'PRIVATE KEY');
    showToast('RSA 密钥对已在本地生成');
  } catch (error) {
    showToast(`生成失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = '<i data-lucide="shield-plus"></i>生成密钥对';
    refreshIcons();
  }
}

function bindEvents() {
  // 防抖包装集中在此处创建，确保被包装的函数都已完成定义。
  const debouncedJsonRefresh = debounce(refreshJsonOutput, 300);
  const debouncedRunRegex = debounce(runRegex, 300);
  const debouncedRenderMarkdown = debounce(renderMarkdown, 300);
  const debouncedDecodeJwt = debounce(decodeJwt, 300);

  window.addEventListener('hashchange', () => activateTool(location.hash));
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => window.setTimeout(() => activateTool(location.hash), 0)));
  // 统一绑定各面板的全屏按钮
  FULLSCREEN_PANELS.forEach((panelId) => {
    $(`#${panelId}-fullscreen`)?.addEventListener('click', () => togglePanelFullscreen(panelId));
  });
  document.addEventListener('fullscreenchange', syncAllFullscreenButtons);
  // 计数即时更新，解析与渲染走防抖。
  $('#json-input').addEventListener('input', updateJsonCharCount);
  $('#json-input').addEventListener('input', debouncedJsonRefresh);
  // 同一个按钮在「全展开 / 全折叠」之间切换，状态读 aria-pressed。
  $('#json-expand-all').addEventListener('click', (event) => {
    if (event.currentTarget.getAttribute('aria-pressed') === 'true') collapseAllJsonNodes();
    else expandAllJsonNodes();
  });
  $('#json-escape').addEventListener('click', escapeJson);
  $('#json-unescape').addEventListener('click', unescapeJson);
  $('#json-minify').addEventListener('click', minifyJsonInput);
  $('#json-sample').addEventListener('click', () => { $('#json-input').value = '{\n  "tool": "DevKit",\n  "features": ["JSON", "Cron", "bcrypt", "RSA"],\n  "local": true\n}'; updateJsonCount(); });
  $('#json-clear').addEventListener('click', () => { $('#json-input').value = ''; updateJsonCount(); });
  $('#cron-parse').addEventListener('click', parseCron);
  $('#cron-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') parseCron(); });
  $('#timestamp-now').addEventListener('click', setTimestampNow);
  $('#timestamp-to-date').addEventListener('click', convertTimestampToDate);
  $('#date-to-timestamp').addEventListener('click', convertDateToTimestamp);
  $('#regex-run').addEventListener('click', runRegex);
  $('#regex-pattern').addEventListener('input', debouncedRunRegex);
  $('#regex-text').addEventListener('input', debouncedRunRegex);
  $$('.regex-flag').forEach((input) => input.addEventListener('change', runRegex));
  // 计数即时更新，预览渲染走防抖。
  $('#markdown-input').addEventListener('input', updateMarkdownCharCount);
  $('#markdown-input').addEventListener('input', debouncedRenderMarkdown);
  $('#markdown-sample').addEventListener('click', loadMarkdownSample);
  $('#bcrypt-rounds').addEventListener('input', (event) => { $('#rounds-value').textContent = event.target.value; });
  $('#toggle-password').addEventListener('click', togglePassword);
  $('#bcrypt-generate').addEventListener('click', generateBcrypt);
  $('#rsa-generate').addEventListener('click', generateRsa);
  $('#jwt-input').addEventListener('input', debouncedDecodeJwt);
  $('#jwt-clear').addEventListener('click', () => { $('#jwt-input').value = ''; decodeJwt(); });
  $('#password-length').addEventListener('input', (event) => { $('#password-length-value').textContent = event.target.value; });
  $('#password-generate').addEventListener('click', generatePassword);
  $$('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy)));
  $('#theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light') ? 'dark' : 'light'));
}

/** 优先读取上次选择，其次跟随系统偏好，默认深色。 */
function restoreTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    // localStorage 不可用时退回系统偏好。
  }
  if (saved === 'light' || saved === 'dark') { applyTheme(saved); return; }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
}

refreshIcons();
bindEvents();
restoreTheme();
activateTool(location.hash || '#json');
