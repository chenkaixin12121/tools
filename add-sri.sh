#!/usr/bin/env bash
# 为 index.html 中的 CDN 脚本补 SRI 完整性校验。
#
# PowerShell 版（add-sri.ps1）的等价实现，二选一即可。
# 在 Git Bash 里运行：
#   bash add-sri.sh
#
# 幂等：重复运行结果一致。改动前自动备份到 index.html.sri-backup。

set -euo pipefail

cd "$(dirname "$0")"

HTML=index.html
BACKUP=index.html.sri-backup

# Google Fonts 的 css2 接口按 User-Agent 返回不同内容，字节不固定，
# 无法也不应该加 SRI，故不在此列。
URLS=(
  "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"
  "https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js"
  "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js"
)

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    %s\n' "$1"; }

[ -f "$HTML" ] || { echo "找不到 $HTML，请在项目根目录运行。" >&2; exit 1; }

# --- 第 1 步：检查 HTML 状态 -------------------------------------------------
step "检查 $HTML"
ok "行数 $(wc -l < "$HTML")，字节 $(wc -c < "$HTML")"

for u in "${URLS[@]}"; do
  grep -qF "$u" "$HTML" || { echo "$HTML 里找不到 $u" >&2; exit 1; }
done
ok "三个 CDN 标签均已找到"

# --- 第 2 步：下载并计算 sha384 ----------------------------------------------
step "下载资源并计算 SHA-384"

# 优先用 openssl，缺失时退回 sha384sum，两者在 Git Bash 里通常至少有一个。
compute_hash() {
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha384 -binary "$1" | openssl base64 -A
  elif command -v sha384sum >/dev/null 2>&1; then
    sha384sum "$1" | cut -d' ' -f1 | xxd -r -p | base64 -w0
  else
    echo "既没有 openssl 也没有 sha384sum，无法计算哈希。" >&2
    return 1
  fi
}

declare -A HASHES
for u in "${URLS[@]}"; do
  tmp=$(mktemp)
  # -f 让 HTTP 错误码变成非零退出，避免把错误页面算进哈希。
  if ! curl -fsSL "$u" -o "$tmp"; then
    rm -f "$tmp"
    echo "下载失败：$u" >&2
    exit 1
  fi
  [ -s "$tmp" ] || { rm -f "$tmp"; echo "下载到空内容：$u" >&2; exit 1; }

  HASHES["$u"]="sha384-$(compute_hash "$tmp")"
  ok "$(basename "$u")  $(wc -c < "$tmp") 字节"
  printf '      %s\n' "${HASHES[$u]}"
  rm -f "$tmp"
done

# --- 第 3 步：备份后改写标签 --------------------------------------------------
step "写入 integrity 属性"

cp "$HTML" "$BACKUP"
ok "已备份到 $BACKUP"

# 用 python 做替换：正则匹配整个 script 标签连同已有属性整体重建，
# 保证反复运行不叠加重复属性。同时校验每个标签恰好匹配一次。
python_bin=$(command -v python3 || command -v python || true)
[ -n "$python_bin" ] || { echo "需要 python 来做安全替换，Git Bash 通常自带；或改用 add-sri.ps1。" >&2; exit 1; }

# 构造「url digest」交替的扁平参数序列，再交给 python 两两配对。
args=("$HTML")
for url in "${URLS[@]}"; do args+=("$url" "${HASHES[$url]}"); done
"$python_bin" - "${args[@]}" <<'PYEOF'
import re, sys
path = sys.argv[1]
pairs = [(sys.argv[i], sys.argv[i + 1]) for i in range(2, len(sys.argv), 2)]

with open(path, encoding='utf-8') as f:
    html = f.read()

for url, digest in pairs:
    pat = r'<script\s+src="' + re.escape(url) + r'"[^>]*>\s*</script>'
    n = len(re.findall(pat, html))
    if n != 1:
        sys.exit(f'期望匹配 1 个标签，实际 {n} 个：{url}。已备份，未改动。')
    rep = ('<script src="' + url + '" integrity="' + digest +
           '" crossorigin="anonymous" referrerpolicy="no-referrer"></script>')
    html = re.sub(pat, lambda m: rep, html)

# 顺手更新那段「SRI 待补」的注释，避免文件里留下自相矛盾的说明。
old = r'(?s)<!--\s*\r?\n\s*SRI 待补.*?-->'
new = ('<!--\n'
       '      CDN 脚本已启用 SRI 完整性校验。\n'
       '      升级 lucide 或 bcryptjs 版本号后必须重新运行本脚本重算 integrity，\n'
       '      否则旧哈希与新文件不匹配，浏览器会拒绝执行脚本。\n'
       '    -->')
if re.search(old, html):
    html = re.sub(old, lambda m: new, html)
    print('    已更新过期的 SRI 注释')

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(html)
print('    已写入 ' + path)
PYEOF

# --- 第 4 步：回读校验 --------------------------------------------------------
step "校验结果"

fail=0
for u in "${URLS[@]}"; do
  if grep -qF "integrity=\"${HASHES[$u]}\"" "$HTML"; then
    ok "OK  $(basename "$u")"
  else
    echo "    缺失  $u" >&2
    fail=1
  fi
done

# integrity 应恰好 3 次；crossorigin= 也应为 3 次
# （preconnect 上的 crossorigin 是裸属性，不含等号，不计入）。
n_int=$(grep -o 'integrity=' "$HTML" | wc -l)
n_cors=$(grep -o 'crossorigin=' "$HTML" | wc -l)
[ "$n_int" -eq 3 ]  || { echo "    integrity= 出现 $n_int 次，预期 3 次" >&2; fail=1; }
[ "$n_cors" -eq 3 ] || { echo "    crossorigin= 出现 $n_cors 次，预期 3 次" >&2; fail=1; }

if [ "$fail" -ne 0 ]; then
  printf '\n校验未通过。恢复备份：\n  cp %s %s\n' "$BACKUP" "$HTML" >&2
  exit 1
fi

cat <<EOF

完成。接下来：

1. 浏览器打开 $HTML，按 F12 看 Console。
   若出现 "Failed to find a valid digest ... integrity" 说明哈希不匹配，
   执行 cp $BACKUP $HTML 恢复，然后把报错发出来。

2. 确认图标显示正常（lucide 生效）、bcrypt 面板能算出哈希（bcryptjs 生效）、
   YAML 工具能出结构树（js-yaml 生效）。

3. 都正常后删掉备份并提交：
     rm $BACKUP
     git add index.html
     git commit -m "security: 为 CDN 脚本添加 SRI 完整性校验"

注意：以后新增或升级 lucide、bcryptjs、js-yaml 的版本号，必须重新跑一次本脚本。
EOF
