/* 本地生成二维码，UTF-8 编码支持中文和 emoji。 */
(() => {
  const el = (name) => document.getElementById(`qr-${name}`);
  const encoder = new TextEncoder();
  let timer, ready = false;
  function reset(message, error = false) {
    ready = false;
    el('download').disabled = true;
    el('canvas').hidden = true;
    el('placeholder').hidden = false;
    el('dimensions').textContent = '';
    el('status').textContent = message;
    el('status').className = `validation-state ${error ? 'error' : 'neutral'}`;
  }
  function render() {
    const value = el('input').value;
    if (!value.trim()) { reset('等待输入'); return; }
    if (typeof qrcode !== 'function') { reset('二维码组件加载失败，请刷新页面重试', true); return; }
    const bytes = encoder.encode(value), level = el('level').value;
    // 第 40 版字节模式容量，提前拦截过长文本。
    if (bytes.length > { L:2953, M:2331, Q:1663, H:1273 }[level]) { reset('内容超出当前纠错等级的容量，请缩短文本或降低纠错等级', true); return; }
    try {
      qrcode.stringToBytes = (text) => Array.from(encoder.encode(text));
      const code = qrcode(0, level);
      code.addData(value, 'Byte'); code.make();
      const canvas = el('canvas'), pixels = Number(el('size').value), modules = code.getModuleCount();
      const unit = Math.floor(pixels / (modules + 8));
      const offset = Math.floor((pixels - modules * unit) / 2);
      canvas.width = canvas.height = pixels;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, pixels, pixels);
      context.fillStyle = '#000000';
      for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) {
        if (code.isDark(row, col)) context.fillRect(offset + col * unit, offset + row * unit, unit, unit);
      }
      canvas.hidden = false;
      el('placeholder').hidden = true;
      el('download').disabled = false;
      el('dimensions').textContent = `${pixels} × ${pixels} px`;
      el('status').className = 'validation-state neutral';
      el('status').textContent = '已生成，可下载 PNG';
      ready = true;
    } catch { reset('无法生成二维码，请缩短内容后重试', true); }
  }
  function update() {
    clearTimeout(timer);
    el('count').textContent = `${encoder.encode(el('input').value).length} 字节`;
    reset(el('input').value.trim() ? '正在生成…' : '等待输入');
    timer = setTimeout(render, 180);
  }
  el('input').addEventListener('input', update);
  ['size', 'level'].forEach((name) => el(name).addEventListener('change', update));
  el('clear').addEventListener('click', () => { el('input').value = ''; update(); el('input').focus(); });
  el('sample').addEventListener('click', () => { el('input').value = 'https://example.com'; update(); });
  el('download').addEventListener('click', () => {
    if (!ready) return;
    const link = document.createElement('a');
    link.download = `qrcode-${el('size').value}.png`;
    link.href = el('canvas').toDataURL('image/png'); link.click();
  });
})();
