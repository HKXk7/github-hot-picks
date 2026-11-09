# 终端触发云端日更的 PowerShell 包装。
#
# 为什么需要它：直接 `npm run daily:trigger` 有两个坑，都是复制粘贴造成的：
#   1. 必须站在项目目录里 —— npm 只认「当前目录下的 package.json」，在 C:\windows\system32
#      里跑就会 ENOENT（Could not read package.json）。
#   2. `$env:GH_TOKEN="ghp_..."` 从聊天框复制时，引号常被换成全角「“ ”」；
#      PowerShell 5.1 会把它当成没结束的字符串，于是冒出一堆 `>>` 续行提示，
#      后面的 cd 被吞进字符串里，看起来「什么都没发生」。
# 这个脚本把 token 从剪贴板取，全程不用引号。
#
# 用法（二选一）：
#   .\scripts\trigger-daily.ps1                  # token 从剪贴板取（推荐）
#   .\scripts\trigger-daily.ps1 -Token 'ghp_...' # 显式给（注意用直引号，别用全角）
#   .\scripts\trigger-daily.ps1 -NoWait          # 只触发，不等结果
param(
  [string]$Token = $env:GH_TOKEN,
  [switch]$NoWait
)

$ErrorActionPreference = 'Stop'
$pattern = '(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{36})'

if ($Token -notmatch $pattern) {
  $clip = Get-Clipboard -ErrorAction SilentlyContinue
  if ($clip) {
    $m = [regex]::Match(($clip -join "`n"), $pattern)
    if ($m.Success) {
      $Token = $m.Value
      Write-Host 'Token 取自剪贴板。'
    }
  }
}

if ($Token -notmatch $pattern) {
  $shape = if (-not $Token) { '空' } else { "长度 $($Token.Length)、开头 '$($Token.Substring(0, [Math]::Min(6, $Token.Length)))'" }
  throw ("没有拿到有效的 GitHub token（当前值：{0}）。复制 token 页面上那一串 ghp_... 到剪贴板后重跑。" -f $shape)
}

$env:GH_TOKEN = $Token

# 本机的 GitHub 加速器/代理会用自签 CA 重签证书，Node 默认只信自带 CA 列表，
# fetch 会直接失败（UNABLE_TO_VERIFY_LEAF_SIGNATURE）。--use-system-ca 让它信任系统证书库。
$version = (node -v).Trim()
$major = [int]($version -replace '^v(\d+).*', '$1')
if ($major -lt 22) { throw "需要 Node 22+ 才能用 --use-system-ca，当前 $version" }

$nodeArgs = @('--use-system-ca', (Join-Path $PSScriptRoot 'trigger-daily.mjs'))
if ($NoWait) { $nodeArgs += '--no-wait' }

node @nodeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }