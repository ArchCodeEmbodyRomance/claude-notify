# claude-notify

Claude Code 跨平台桌面通知脚本。当 Claude 完成回答或需要权限确认时，发送桌面通知并支持点击激活对应窗口。

## 功能

- **桌面通知**：Claude 回答完成或等待权限时弹出系统通知
- **多会话区分**：通知标题显示 `[应用名/项目名]`，内容显示回答摘要
- **点击激活窗口**：点击通知自动聚焦到对应的 IDE/终端窗口（支持最小化恢复）
- **前台检测**：窗口在前台时默认不弹通知，避免打扰
- **自动识别 IDE**：通过进程树检测父进程，支持多种 IDE 和终端

## 支持平台

| 平台 | 通知方式 | 点击激活 |
|------|---------|---------|
| Windows | Toast 通知 | 通过自定义协议处理器 |
| macOS | osascript / terminal-notifier | osascript activate / terminal-notifier -activate |

## 支持的 IDE/终端

**Windows**: Rider, VS Code, VS Code Insiders, Cursor, Windsurf, IntelliJ IDEA, WebStorm, PyCharm, GoLand, PhpStorm, Fleet, Windows Terminal

**macOS**: Rider, VS Code, Cursor, IntelliJ IDEA, WebStorm, PyCharm, GoLand, PhpStorm, Fleet, iTerm2, Terminal, Warp, Alacritty

## 安装

```bash
git clone <repo-url>
cd claude-notify
node install.js
```

安装脚本会：
1. 复制 `notify.js` 到 `~/.claude/`
2. 在 `~/.claude/settings.json` 中配置 Stop 和 Notification hooks
3. (Windows) 注册 `claude-focus://` 协议处理器
4. (Windows) 创建开始菜单快捷方式（用于 Toast 通知源标识）

## 配置

通知行为通过 hook 命令行参数控制，编辑 `~/.claude/settings.json` 中对应的 hook command：

| 参数 | 默认 | 说明 |
|------|------|------|
| `--notify-when-focused` | 不加（关闭） | 加上后，父窗口在前台时仍发送通知 |

示例：在 command 末尾加 `--notify-when-focused` 即可开启：

```json
"command": "node \"$HOME/.claude/notify.js\" --event stop --notify-when-focused"
```

## 工作原理

1. Claude Code 的 Stop/Notification hook 触发时，通过 stdin 传入 JSON 数据
2. 脚本遍历进程树，检测启动 Claude Code 的父进程（IDE 或终端）
3. 根据平台发送桌面通知，通知内容包含项目名和回答摘要
4. (Windows) 通知携带 `claude-focus://` 协议链接，点击时通过 VBS 包装器隐藏启动 node 脚本激活目标窗口
5. (macOS) 使用 `terminal-notifier -activate` 或 `osascript tell app to activate` 激活窗口

## 手动测试

```bash
echo '{"session_id":"test","cwd":"/path/to/project","last_assistant_message":"测试通知内容"}' | node ~/.claude/notify.js --event stop
```

## 许可证

MIT
