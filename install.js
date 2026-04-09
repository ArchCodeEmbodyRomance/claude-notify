#!/usr/bin/env node
// claude-notify 安装脚本
// 将 notify.js 和配置复制到 ~/.claude/ 并配置 hooks

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SRC_DIR = __dirname;

// 确保 ~/.claude 存在
if (!fs.existsSync(CLAUDE_DIR)) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
}

// 复制 notify.js
const srcNotify = path.join(SRC_DIR, 'notify.js');
const dstNotify = path.join(CLAUDE_DIR, 'notify.js');
fs.copyFileSync(srcNotify, dstNotify);
console.log(`已复制 notify.js -> ${dstNotify}`);

// 读取或创建 settings.json
const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    console.error(`错误：settings.json 解析失败，文件可能已损坏：${e.message}`);
    console.error(`路径：${settingsPath}`);
    console.error('请手动修复该文件后重新运行安装脚本。');
    process.exit(1);
  }
}

// 配置 hooks
const hookCommand = (event) => `node "$HOME/.claude/notify.js" --event ${event}`;

if (!settings.hooks) settings.hooks = {};

// 合并 hook：如果已存在包含 notify.js 的条目则更新，否则追加
function upsertHook(hookArray, matcher, hookEntry) {
  const idx = hookArray.findIndex(
    item => item.matcher === matcher &&
      item.hooks && item.hooks.some(h => h.command && h.command.includes('notify.js'))
  );
  if (idx >= 0) {
    hookArray[idx] = { matcher, hooks: [hookEntry] };
  } else {
    hookArray.push({ matcher, hooks: [hookEntry] });
  }
}

if (!settings.hooks.Stop) settings.hooks.Stop = [];
upsertHook(settings.hooks.Stop, '', { type: 'command', command: hookCommand('stop'), timeout: 15 });

if (!settings.hooks.Notification) settings.hooks.Notification = [];
upsertHook(settings.hooks.Notification, 'permission_prompt', { type: 'command', command: hookCommand('permission'), timeout: 15 });

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
console.log(`已配置 hooks -> ${settingsPath}`);

// Windows: 注册协议处理器和 AppId
if (os.platform() === 'win32') {
  console.log('正在注册 Windows 协议处理器...');
  try {
    execSync(`node "${dstNotify}" --register`, { stdio: 'inherit', timeout: 15000 });
    console.log('协议处理器注册完成');
  } catch (e) {
    console.error('协议处理器注册失败:', e.message);
  }

  // 创建开始菜单快捷方式（用于 Toast 通知源标识）
  console.log('正在创建开始菜单快捷方式...');
  const lnkPath = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude Code.lnk');
  if (!fs.existsSync(lnkPath)) {
    const ps = `
$WshShell = New-Object -ComObject WScript.Shell
$lnk = $WshShell.CreateShortcut('${lnkPath.replace(/'/g, "''")}')
$lnk.TargetPath = '${process.execPath.replace(/'/g, "''")}'
$lnk.Description = 'Claude Code Notification'
$lnk.Save()
# 设置 AppUserModelId
$shell = [System.Runtime.InteropServices.Marshal]::GetTypeFromCLSID([guid]'9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3')
$propStore = [System.Activator]::CreateInstance($shell)
$method = $propStore.GetType().GetMethod('SHGetPropertyStoreFromParsingName', [System.Reflection.BindingFlags]'NonPublic,Static' -bor [System.Reflection.BindingFlags]'Public,Static')
if (-not $method) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AppIdHelper {
    [DllImport("shell32.dll", SetLastError = true)]
    public static extern int SHGetPropertyStoreFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath, IntPtr pbc, int flags,
        ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object store);
}
"@
    $IID_IPropertyStore = [Guid]'886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99'
    $store = $null
    [AppIdHelper]::SHGetPropertyStoreFromParsingName('${lnkPath.replace(/'/g, "''")}', [IntPtr]::Zero, 4, [ref]$IID_IPropertyStore, [ref]$store) | Out-Null
    if ($store) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY {
    public Guid fmtid;
    public uint pid;
}
"@
        $pk = New-Object PROPERTYKEY
        $pk.fmtid = [Guid]'9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3'
        $pk.pid = 5
        $store.GetType().InvokeMember('SetValue', 'InvokeMethod', $null, $store, @($pk, 'Claude.Code.Notification'))
        $store.GetType().InvokeMember('Commit', 'InvokeMethod', $null, $store, $null)
    }
}
`;
    const tmpFile = path.join(os.tmpdir(), `claude-lnk-${process.pid}.ps1`);
    fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
    try {
      execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tmpFile}"`, { stdio: 'inherit', timeout: 15000 });
      console.log('快捷方式创建完成');
    } catch (e) {
      console.error('快捷方式创建失败（通知仍可工作，但来源显示为 PowerShell）:', e.message);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  } else {
    console.log('快捷方式已存在，跳过');
  }
}

console.log('\n安装完成！重启 Claude Code 即可生效。');

// macOS 安装引导
if (os.platform() === 'darwin') {
  console.log('\n--- macOS 提示 ---');
  console.log('建议安装 terminal-notifier 以获得更好的通知体验（可选，支持点击通知激活窗口）：');
  console.log('  brew install terminal-notifier');
  console.log('首次收到通知时，系统可能会弹出权限请求，请在「系统设置 > 通知」中允许通知权限。');
}
