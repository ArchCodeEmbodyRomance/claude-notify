#!/usr/bin/env node
// claude-notify 卸载脚本
// 从 ~/.claude/ 移除 notify.js 及相关配置，清理 hooks 和 Windows 注册表

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

// 1. 从 settings.json 中移除 notify.js 相关的 hook 条目
const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
try {
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.hooks) {
      let removed = 0;
      for (const event of Object.keys(settings.hooks)) {
        const matchers = settings.hooks[event];
        if (!Array.isArray(matchers)) continue;
        for (let i = matchers.length - 1; i >= 0; i--) {
          const matcher = matchers[i];
          if (!matcher.hooks || !Array.isArray(matcher.hooks)) continue;
          matcher.hooks = matcher.hooks.filter(h => {
            if (h.command && h.command.includes('notify.js')) {
              removed++;
              return false;
            }
            return true;
          });
          // 如果该 matcher 下已无 hook，移除整个 matcher
          if (matcher.hooks.length === 0) {
            matchers.splice(i, 1);
          }
        }
        // 如果该事件下已无 matcher，移除整个事件
        if (matchers.length === 0) {
          delete settings.hooks[event];
        }
      }
      // 如果 hooks 为空对象，移除 hooks 键
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      console.log(`已从 settings.json 移除 ${removed} 个 notify.js hook 条目`);
    } else {
      console.log('settings.json 中无 hooks 配置，跳过');
    }
  } else {
    console.log('settings.json 不存在，跳过');
  }
} catch (e) {
  console.error('清理 settings.json 失败:', e.message);
}

// 2. 删除 ~/.claude/notify.js
const notifyPath = path.join(CLAUDE_DIR, 'notify.js');
try {
  if (fs.existsSync(notifyPath)) {
    fs.unlinkSync(notifyPath);
    console.log(`已删除 ${notifyPath}`);
  } else {
    console.log(`${notifyPath} 不存在，跳过`);
  }
} catch (e) {
  console.error(`删除 ${notifyPath} 失败:`, e.message);
}

// 3. 删除 ~/.claude/notify-focus.vbs（如果存在）
const vbsPath = path.join(CLAUDE_DIR, 'notify-focus.vbs');
try {
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    console.log(`已删除 ${vbsPath}`);
  } else {
    console.log(`${vbsPath} 不存在，跳过`);
  }
} catch (e) {
  console.error(`删除 ${vbsPath} 失败:`, e.message);
}

// 4. (Windows) 删除注册表协议处理器和开始菜单快捷方式
if (os.platform() === 'win32') {
  // 删除注册表 HKCU:\Software\Classes\claude-focus
  try {
    execSync(
      'powershell -ExecutionPolicy Bypass -NoProfile -Command "if (Test-Path \'HKCU:\\Software\\Classes\\claude-focus\') { Remove-Item -Path \'HKCU:\\Software\\Classes\\claude-focus\' -Recurse -Force; Write-Host \'已删除注册表项 HKCU:\\Software\\Classes\\claude-focus\' } else { Write-Host \'注册表项不存在，跳过\' }"',
      { stdio: 'inherit', timeout: 15000 }
    );
  } catch (e) {
    console.error('删除注册表项失败:', e.message);
  }

  // 5. 删除开始菜单快捷方式
  const lnkPath = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude Code.lnk');
  try {
    if (fs.existsSync(lnkPath)) {
      fs.unlinkSync(lnkPath);
      console.log(`已删除快捷方式 ${lnkPath}`);
    } else {
      console.log(`快捷方式 ${lnkPath} 不存在，跳过`);
    }
  } catch (e) {
    console.error(`删除快捷方式失败:`, e.message);
  }
}

console.log('\n卸载完成！');
