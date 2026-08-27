# 为 index.html 中的 CDN 脚本补 SRI（Subresource Integrity）校验。
#
# 为什么要在你本机跑：计算 SRI 必须拿到文件的确切字节，
# 而哈希算出来的正是你的用户实际会收到的内容，比任何第三方代算都可靠。
#
# 用法：在项目目录执行
#   powershell -ExecutionPolicy Bypass -File .\add-sri.ps1
#
# 脚本是幂等的，重复运行结果一致。改动前会自动备份。

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$htmlPath = Join-Path $PSScriptRoot 'index.html'
$backupPath = Join-Path $PSScriptRoot 'index.html.sri-backup'

# 需要补 integrity 的 CDN 资源。
# 注意：Google Fonts 的 css2 接口会按 User-Agent 返回不同内容（字体格式协商），
# 字节不固定，因此无法也不应该加 SRI，这里不处理它。
$targets = @(
  'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js'
)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

if (-not (Test-Path $htmlPath)) {
  throw "找不到 index.html，请把脚本放在项目根目录再运行。"
}

# --- 第 1 步：读取并检查 HTML 是否处于预期状态 -------------------------------
Write-Step '检查 index.html'

$html = [IO.File]::ReadAllText($htmlPath)
$lineCount = ([regex]::Matches($html, "`n")).Count + 1
Write-Ok "行数 $lineCount，字节 $($html.Length)"

# 异常形状检查：大量重复的空 app-shell div 说明文件可能被写坏了，
# 这种情况下不要继续改，先人工确认。
$emptyShells = ([regex]::Matches($html, '<div class="app-shell"></div>')).Count
if ($emptyShells -ge 5) {
  throw "检测到 $emptyShells 个重复的空 <div class=`"app-shell`"></div>，index.html 可能已损坏。请先确认文件内容，不要在此状态下改动。"
}

# 确认两个目标标签都在，避免在错误的文件上操作。
foreach ($url in $targets) {
  if ($html -notlike "*$url*") {
    throw "index.html 里找不到 $url，请确认文件是否正确。"
  }
}
Write-Ok '两个 CDN 标签均已找到'

# --- 第 2 步：下载并计算 sha384 ----------------------------------------------
Write-Step '下载资源并计算 SHA-384'

# Windows PowerShell 5.1 默认可能仍用 TLS 1.0/1.1，而 CDN 只接受 1.2 以上。
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  Write-Warn '无法调整 TLS 设置，若下载失败请改用 PowerShell 7。'
}

$hashes = @{}
foreach ($url in $targets) {
  # 落到临时文件再读字节，避免 Invoke-WebRequest 对文本类型做编码转换 ——
  # JS 的 Content-Type 是文本，若取 .Content 会拿到解码后的字符串，哈希就错了。
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    $bytes = [IO.File]::ReadAllBytes($tmp)
  } catch {
    throw "下载失败：$url`n$($_.Exception.Message)`n请检查网络或代理后重试。"
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }

  if ($bytes.Length -eq 0) {
    throw "下载到空内容：$url"
  }

  $sha = [Security.Cryptography.SHA384]::Create()
  try {
    $digest = $sha.ComputeHash($bytes)
  } finally {
    $sha.Dispose()
  }

  $hashes[$url] = 'sha384-' + [Convert]::ToBase64String($digest)
  Write-Ok "$([IO.Path]::GetFileName($url))  $($bytes.Length) 字节"
  Write-Host "      $($hashes[$url])" -ForegroundColor DarkGray
}

# --- 第 3 步：备份后改写标签 --------------------------------------------------
Write-Step '写入 integrity 属性'

[IO.File]::WriteAllText($backupPath, $html)
Write-Ok "已备份到 $([IO.Path]::GetFileName($backupPath))"

$updated = $html
foreach ($url in $targets) {
  $escaped = [regex]::Escape($url)
  # 匹配整个 script 标签，连同可能已存在的 integrity / crossorigin，
  # 整体重建，保证反复运行不会叠加重复属性。
  $pattern = '<script\s+src="' + $escaped + '"[^>]*>\s*</script>'
  $replacement = '<script src="' + $url + '" integrity="' + $hashes[$url] +
                 '" crossorigin="anonymous" referrerpolicy="no-referrer"></script>'

  $matched = [regex]::Matches($updated, $pattern)
  if ($matched.Count -ne 1) {
    throw "期望匹配到 1 个标签，实际 $($matched.Count) 个：$url。文件已备份，未做改动。"
  }
  $updated = [regex]::Replace($updated, $pattern, $replacement)
}

# 顺手更新那段「SRI 待补」的注释，否则文件里会留下自相矛盾的说明。
$oldComment = '(?s)<!--\s*\r?\n\s*SRI 待补.*?-->'
$newComment = @'
<!--
      CDN 脚本已启用 SRI 完整性校验。
      升级 lucide 或 bcryptjs 版本号后必须重新运行 add-sri.ps1 重算 integrity，
      否则旧哈希与新文件不匹配，浏览器会拒绝执行脚本。
    -->
'@
# here-string 终止符后不接任何内容，避免解析歧义；TrimEnd 无参即去掉尾部空白与换行。
$newComment = $newComment.TrimEnd()

if ([regex]::IsMatch($updated, $oldComment)) {
  # 用字符串重载，不用 scriptblock —— PS 5.1 不会把 scriptblock 自动转成 MatchEvaluator。
  # $newComment 里没有 $ 字符，不存在被当成替换组引用的风险。
  $updated = [regex]::Replace($updated, $oldComment, $newComment)
  Write-Ok '已更新过期的 SRI 注释'
}

[IO.File]::WriteAllText($htmlPath, $updated)
Write-Ok '已写入 index.html'

# --- 第 4 步：回读校验 --------------------------------------------------------
Write-Step '校验结果'

$verify = [IO.File]::ReadAllText($htmlPath)
$ok = $true

foreach ($url in $targets) {
  $expected = 'integrity="' + $hashes[$url] + '"'
  if ($verify -like "*$expected*") {
    Write-Ok "OK  $([IO.Path]::GetFileName($url))"
  } else {
    Write-Warn "缺失  $url"
    $ok = $false
  }
}

# 属性不该出现重复，重复说明正则匹配有误。
foreach ($attr in @('integrity=', 'crossorigin=')) {
  $n = ([regex]::Matches($verify, [regex]::Escape($attr))).Count
  # crossorigin 另有一处在 fonts.gstatic 的 preconnect 上，属正常。
  $limit = if ($attr -eq 'crossorigin=') { 3 } else { 2 }
  if ($n -gt $limit) {
    Write-Warn "$attr 出现 $n 次，超出预期的 $limit 次"
    $ok = $false
  }
}

if (-not $ok) {
  Write-Host "`n校验未通过。恢复备份：" -ForegroundColor Red
  Write-Host "  Copy-Item '$backupPath' '$htmlPath' -Force" -ForegroundColor Red
  exit 1
}

$summary = @"

完成。接下来：

1. 用浏览器打开 index.html，按 F12 看 Console。
   若出现 "Failed to find a valid digest ... integrity" 说明哈希不匹配，
   执行下面这行恢复，然后把报错发出来：
     Copy-Item '$backupPath' '$htmlPath' -Force

2. 确认图标显示正常（lucide 生效）、bcrypt 工具能算出哈希（bcryptjs 生效）。

3. 都正常后删掉备份并提交：
     Remove-Item '$backupPath'
     git add index.html
     git commit -m "security: 为 CDN 脚本添加 SRI 完整性校验"

注意：以后升级 lucide 或 bcryptjs 的版本号，必须重新跑一次本脚本，
      旧哈希对不上新文件，浏览器会直接拒绝执行脚本。
"@
Write-Host $summary -ForegroundColor Green

