#!/usr/bin/env node
// Claude Code 跨平台通知脚本
// 支持 Windows (toast + 点击激活) 和 macOS (osascript/terminal-notifier)

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = os.platform();

// ─── 工具函数 ───

// 净化字符串，移除控制字符防止注入
function sanitize(str) {
  return String(str || '').replace(/[\r\n\t\0]/g, ' ').trim();
}

// 截断字符串（多字节安全）
function truncate(str, max) {
  const s = str.replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('') + '...' : s;
}

// ─── IDE 进程名映射表 ───

const IDE_MAP_WIN = {
  'rider64.exe': { name: 'Rider', bundle: 'com.jetbrains.rider' },
  'rider.exe': { name: 'Rider', bundle: 'com.jetbrains.rider' },
  'code.exe': { name: 'VS Code', bundle: 'com.microsoft.VSCode' },
  'code - insiders.exe': { name: 'VS Code Insiders', bundle: 'com.microsoft.VSCodeInsiders' },
  'cursor.exe': { name: 'Cursor', bundle: 'com.todesktop.230313mzl4w4u92' },
  'windsurf.exe': { name: 'Windsurf', bundle: null },
  'idea64.exe': { name: 'IntelliJ IDEA', bundle: 'com.jetbrains.intellij' },
  'idea.exe': { name: 'IntelliJ IDEA', bundle: 'com.jetbrains.intellij' },
  'webstorm64.exe': { name: 'WebStorm', bundle: 'com.jetbrains.WebStorm' },
  'pycharm64.exe': { name: 'PyCharm', bundle: 'com.jetbrains.pycharm' },
  'goland64.exe': { name: 'GoLand', bundle: 'com.jetbrains.goland' },
  'phpstorm64.exe': { name: 'PhpStorm', bundle: 'com.jetbrains.PhpStorm' },
  'fleet.exe': { name: 'Fleet', bundle: 'com.jetbrains.fleet' },
  'windowsterminal.exe': { name: 'Terminal', bundle: null },
  'wt.exe': { name: 'Terminal', bundle: null },
};

const IDE_MAP_MAC = {
  'rider': { name: 'Rider', bundle: 'com.jetbrains.rider' },
  'code': { name: 'VS Code', bundle: 'com.microsoft.VSCode' },
  'cursor': { name: 'Cursor', bundle: 'com.todesktop.230313mzl4w4u92' },
  'idea': { name: 'IntelliJ IDEA', bundle: 'com.jetbrains.intellij' },
  'webstorm': { name: 'WebStorm', bundle: 'com.jetbrains.WebStorm' },
  'pycharm': { name: 'PyCharm', bundle: 'com.jetbrains.pycharm' },
  'goland': { name: 'GoLand', bundle: 'com.jetbrains.goland' },
  'phpstorm': { name: 'PhpStorm', bundle: 'com.jetbrains.PhpStorm' },
  'fleet': { name: 'Fleet', bundle: 'com.jetbrains.fleet' },
  'iterm2': { name: 'iTerm2', bundle: 'com.googlecode.iterm2' },
  'terminal': { name: 'Terminal', bundle: 'com.apple.Terminal' },
  'warp': { name: 'Warp', bundle: 'dev.warp.Warp-Stable' },
  'alacritty': { name: 'Alacritty', bundle: 'org.alacritty' },
};

// 全局变量
let hookData = {};
let project = 'Claude Code';

// ─── 模式分发 ───
const args = process.argv.slice(2);

// --focus 模式: 被协议处理器调用，激活指定 PID 的窗口
if (args[0] === '--focus') {
  const raw = args[1] || '';
  // 解析 claude-focus://PID?session=xxx&project=xxx/
  const urlStr = raw.replace(/^claude-focus:\/\//, '').replace(/\/$/, '');
  const qIdx = urlStr.indexOf('?');
  const pidStr = qIdx >= 0 ? urlStr.substring(0, qIdx) : urlStr;
  const pid = parseInt(pidStr, 10);
  const params = {};
  if (qIdx >= 0) {
    try {
      const sp = new URLSearchParams(urlStr.substring(qIdx + 1));
      for (const [k, v] of sp) params[k] = v;
    } catch {}
  }
  hookData = { session_id: params.session || '', cwd: params.project || '' };
  project = sanitize(params.project || '');
  if (pid > 0) focusWindow(pid);
  process.exit(0);
}

// --register 模式: 注册 URL 协议 (首次运行)
if (args[0] === '--register') {
  registerProtocol();
  process.exit(0);
}

// ─── 通知模式 (默认) ───
let eventType = 'stop';
const eventIdx = args.indexOf('--event');
if (eventIdx !== -1 && args[eventIdx + 1]) {
  eventType = args[eventIdx + 1];
}

// 从 stdin 读取 hook JSON
try {
  const input = fs.readFileSync(0, 'utf8');
  hookData = JSON.parse(input);
} catch (e) {
  // stdin 读取失败，忽略
}

// 提取项目目录名
project = hookData.cwd ? sanitize(path.basename(hookData.cwd)) : 'Claude Code';

// 检测父进程 IDE
const parentApp = detectParentApp();

// 获取对话上下文
function getHint() {
  if (hookData.last_assistant_message) {
    return truncate(hookData.last_assistant_message, 80);
  }
  if (hookData.message) {
    return truncate(hookData.message, 80);
  }
  return '';
}

const hint = getHint();

// 构建标题和消息
const appLabel = parentApp ? parentApp.name : 'Claude Code';
let title, message;
if (eventType === 'permission') {
  title = `[${appLabel}/${project}] 需要权限确认`;
  message = hint || 'Claude 正在等待你的权限确认';
} else {
  title = `[${appLabel}/${project}] 回答完成`;
  message = hint || 'Claude 已完成回答，等待你的输入';
}

// 检测父进程窗口是否在前台
function isParentInForeground(parentApp) {
  if (!parentApp || !parentApp.pid) return false;
  if (PLATFORM === 'win32') {
    try {
      const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgCheck {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
${"$"}fgHwnd = [FgCheck]::GetForegroundWindow()
${"$"}fgPid = 0
[FgCheck]::GetWindowThreadProcessId(${"$"}fgHwnd, [ref]${"$"}fgPid) | Out-Null
Write-Output ${"$"}fgPid
`;
      const tmpFile = path.join(os.tmpdir(), `claude-fg-${process.pid}.ps1`);
      fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
      const result = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', tmpFile],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
      try { fs.unlinkSync(tmpFile); } catch {}
      const fgPid = parseInt((result.stdout || '').trim(), 10);
      return fgPid === parentApp.pid;
    } catch {}
  } else if (PLATFORM === 'darwin') {
    try {
      const frontApp = execSync(
        `osascript -e 'tell application "System Events" to get unix id of first process whose frontmost is true'`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      return parseInt(frontApp, 10) === parentApp.pid;
    } catch {}
  }
  return false;
}

// 发送通知（根据命令行参数判断是否跳过）
const notifyWhenFocused = args.includes('--notify-when-focused');
if (!notifyWhenFocused && isParentInForeground(parentApp)) {
  process.exit(0);
}

// 发送通知
try {
  if (PLATFORM === 'win32') {
    ensureProtocolRegistered();
    sendWindowsToast(title, message, parentApp);
  } else if (PLATFORM === 'darwin') {
    sendMacNotification(title, message, parentApp);
  }
} catch {}

// ─── 进程树检测 ───

function detectParentApp() {
  try {
    if (PLATFORM === 'win32') return detectParentAppWin();
    if (PLATFORM === 'darwin') return detectParentAppMac();
  } catch (e) {}
  return null;
}

function detectParentAppWin() {
  // 用 PowerShell 遍历进程树
  // process.ppid 在 MSYS/Git Bash 下可能不是 Windows PID，
  // 所以从当前 PowerShell 进程自身往上查找
  try {
    const ps = `
${"$"}cpid = (Get-CimInstance Win32_Process -Filter "ProcessId=${"$"}PID").ParentProcessId
${"$"}visited = @{}
while (${"$"}cpid -gt 1 -and -not ${"$"}visited.ContainsKey(${"$"}cpid)) {
    ${"$"}visited[${"$"}cpid] = ${"$"}true
    try {
        ${"$"}proc = Get-CimInstance Win32_Process -Filter "ProcessId=${"$"}cpid" -ErrorAction Stop
        ${"$"}name = ${"$"}proc.Name.ToLower()
        ${"$"}ppid = ${"$"}proc.ParentProcessId
        Write-Output "${"$"}cpid,${"$"}name,${"$"}ppid"
        ${"$"}cpid = ${"$"}ppid
    } catch { break }
}
`;
    const tmpFile = path.join(os.tmpdir(), `claude-detect-${process.pid}.ps1`);
    fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
    const result = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', tmpFile],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (result.stdout || '').trim();
    const errOut = (result.stderr || '').trim();
    try { fs.unlinkSync(tmpFile); } catch {}

    const allOut = out || errOut;
    for (const line of allOut.split('\n')) {
      const [pidStr, name, ppid] = line.trim().split(',');
      if (name && IDE_MAP_WIN[name]) {
        return { ...IDE_MAP_WIN[name], pid: parseInt(pidStr, 10) };
      }
    }
  } catch (e) {}
  return null;
}

function detectParentAppMac() {
  let pid = process.ppid;
  const visited = new Set();
  while (pid > 1 && !visited.has(pid)) {
    visited.add(pid);
    try {
      // 合并一次 ps 调用获取进程名和父 PID
      const psOut = execSync(`ps -o comm=,ppid= -p ${pid}`, { encoding: 'utf8', timeout: 3000 }).trim();
      const lastSpace = psOut.lastIndexOf(' ');
      const comm = psOut.substring(0, lastSpace).trim();
      const ppid = parseInt(psOut.substring(lastSpace + 1).trim(), 10);

      const base = path.basename(comm).toLowerCase();
      if (IDE_MAP_MAC[base]) {
        return { ...IDE_MAP_MAC[base], pid };
      }
      // JetBrains IDE 的进程名可能是 java，检查命令行参数
      if (base === 'java') {
        try {
          const fullArgs = execSync(`ps -o args= -p ${pid}`, { encoding: 'utf8', timeout: 3000 }).trim().toLowerCase();
          for (const [key, val] of Object.entries(IDE_MAP_MAC)) {
            if (fullArgs.includes(key) || fullArgs.includes(val.name.toLowerCase())) {
              return { ...val, pid };
            }
          }
        } catch {}
      }
      pid = ppid;
    } catch { break; }
  }
  return null;
}

// ─── Windows: 协议注册 & 窗口激活 ───

function ensureProtocolRegistered() {
  try {
    const check = execSync(
      `powershell -NoProfile -Command "Test-Path 'HKCU:\\Software\\Classes\\claude-focus'"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }
    ).trim();
    if (check === 'True') return;
  } catch {}
  registerProtocol();
}

function registerProtocol() {
  const nodePath = process.execPath;
  const scriptPath = __filename;

  // 创建 VBS 包装器，用隐藏窗口启动 node（避免闪控制台）
  const vbsPath = path.join(os.homedir(), '.claude', 'notify-focus.vbs');
  const vbsText = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run """${nodePath.replace(/\\/g, '\\\\')}""" & " " & """${scriptPath.replace(/\\/g, '\\\\')}""" & " --focus " & """" & WScript.Arguments(0) & """", 0, False\r\n`;
  // 用 UTF-16 LE BOM 写入，确保 wscript 在任何区域设置下都能正确读取
  const buf = Buffer.from('\ufeff' + vbsText, 'utf16le');
  fs.writeFileSync(vbsPath, buf);

  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const cmdValue = `"${sysRoot}\\System32\\wscript.exe" "${vbsPath}" "%1"`;
  const ps = `
New-Item -Path 'HKCU:\\Software\\Classes\\claude-focus' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\claude-focus' -Name '(Default)' -Value 'URL:Claude Focus Protocol'
Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\claude-focus' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\\Software\\Classes\\claude-focus\\shell\\open\\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\claude-focus\\shell\\open\\command' -Name '(Default)' -Value '${cmdValue.replace(/'/g, "''")}'
`;
  const tmpFile = path.join(os.tmpdir(), `claude-reg-${process.pid}.ps1`);
  fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
  try {
    execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tmpFile}"`, { stdio: 'ignore', timeout: 10000 });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function focusWindow(pid) {
  if (PLATFORM === 'win32') {
    const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class Win32Focus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int nMaxCount);
    public const int SW_RESTORE = 9;

    public static List<IntPtr> GetProcessWindows(uint pid) {
        var wins = new List<IntPtr>();
        EnumWindows((h, p) => {
            uint wpid; GetWindowThreadProcessId(h, out wpid);
            if (wpid == pid && IsWindowVisible(h) && GetWindowTextLength(h) > 0) wins.Add(h);
            return true;
        }, IntPtr.Zero);
        return wins;
    }

    public static string GetTitle(IntPtr hWnd) {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, 512);
        return sb.ToString();
    }

    public static void Activate(IntPtr target) {
        if (IsIconic(target)) {
            ShowWindow(target, SW_RESTORE);
            Thread.Sleep(100);
        }
        SetForegroundWindow(target);
    }
}
"@
try {
    ${"$"}windows = [Win32Focus]::GetProcessWindows(${pid})
    if (${"$"}windows.Count -eq 1) {
        [Win32Focus]::Activate(${"$"}windows[0])
    } elseif (${"$"}windows.Count -gt 1) {
        ${"$"}targetCwd = '${(project || '').replace(/'/g, "''")}'
        ${"$"}matched = ${"$"}null
        foreach (${"$"}h in ${"$"}windows) {
            ${"$"}t = [Win32Focus]::GetTitle(${"$"}h)
            if (${"$"}targetCwd -and ${"$"}t -match [regex]::Escape(${"$"}targetCwd)) { ${"$"}matched = ${"$"}h; break }
        }
        if (-not ${"$"}matched) { ${"$"}matched = ${"$"}windows[0] }
        [Win32Focus]::Activate(${"$"}matched)
    }
} catch {}
`;
    const tmpFile = path.join(os.tmpdir(), `claude-focus-${process.pid}.ps1`);
    fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
    try {
      execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tmpFile}"`, { stdio: 'ignore', timeout: 5000 });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  } else if (PLATFORM === 'darwin') {
    try {
      const name = execSync(`ps -o comm= -p ${pid}`, { encoding: 'utf8', timeout: 3000 }).trim();
      const appName = sanitize(path.basename(name));
      spawnSync('osascript', ['-e', `tell application "${appName}" to activate`], { stdio: 'ignore', timeout: 5000 });
    } catch {}
  }
}

// ─── Windows: Toast 通知 ───

function sendWindowsToast(title, message, parentApp) {
  const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const t = escXml(title);
  const m = escXml(message);

  // 点击通知时激活父进程窗口
  const sessionId = encodeURIComponent(hookData.session_id || '');
  const projName = encodeURIComponent(project || '');
  const launchAttr = parentApp
    ? ` activationType='protocol' launch='claude-focus://${parentApp.pid}?session=${sessionId}&amp;project=${projName}'`
    : '';

  const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = @"
<toast${launchAttr} duration='long'>
  <visual>
    <binding template='ToastGeneric'>
      <text>${t}</text>
      <text>${m}</text>
    </binding>
  </visual>
  <audio src='ms-winsoundevent:Notification.Default'/>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude.Code.Notification').Show($toast)
`;
  const tmpFile = path.join(os.tmpdir(), `claude-notify-${process.pid}.ps1`);
  fs.writeFileSync(tmpFile, '\ufeff' + ps, 'utf8');
  try {
    execSync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tmpFile}"`, { stdio: 'ignore', timeout: 10000 });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─── macOS: 通知 ───

function sendMacNotification(title, message, parentApp) {
  // 优先用 terminal-notifier（支持点击激活）
  try {
    execSync('which terminal-notifier', { stdio: 'ignore' });
    const esc = (s) => sanitize(s).replace(/"/g, '\\"');
    let cmd = `terminal-notifier -title "${esc(title)}" -message "${esc(message)}" -sound default`;
    if (parentApp && parentApp.bundle) {
      cmd += ` -activate "${esc(parentApp.bundle)}"`;
    }
    execSync(cmd, { stdio: 'ignore', timeout: 10000 });
    return;
  } catch {}

  // 回退到 osascript（通过 stdin 传递脚本避免 shell 注入）
  const escAs = (s) => sanitize(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `display notification "${escAs(message)}" with title "${escAs(title)}" sound name "Ping"`;
  spawnSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 10000 });
}
