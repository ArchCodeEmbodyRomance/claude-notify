# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
node install.js    # 安装到 ~/.claude/
node uninstall.js  # 从 ~/.claude/ 卸载

# 手动测试通知
echo '{"session_id":"test","cwd":"/path/to/project","last_assistant_message":"测试通知"}' | node ~/.claude/notify.js --event stop
```

零依赖，纯 Node.js 标准库，无构建步骤。

## 架构

notify.js 有三种运行模式，由命令行参数分发（默认通知模式、`--focus` 窗口激活模式、`--register` 协议注册模式）。install.js 和 uninstall.js 必须保持操作对称——install 做的每一步 uninstall 都要逆向清理。

## 设计约束

- **跨平台统一方案优先**：Windows 和 macOS 的功能应尽量用统一的代码路径实现，只在必须时才分平台处理
- **不引入额外 runtime**：只依赖 Node.js 标准库和系统自带工具（PowerShell、osascript），不引入 npm 依赖

## 开发注意事项

- **IDE 映射表对称**：`IDE_MAP_WIN` 和 `IDE_MAP_MAC` 是独立的，新增 IDE 支持需要分别维护两个表，且 bundle ID 要准确（macOS 点击激活依赖它）
- **JetBrains 特殊处理**：macOS 上 JetBrains IDE 进程名是 `java`，需要通过 `ps -o args=` 检查命令行参数来识别具体 IDE
- **PowerShell 临时文件必须带 BOM**：所有 `.ps1` 临时文件写入时带 UTF-8 BOM (`\ufeff`) 前缀，否则在非英文系统上会乱码
- **Windows 点击激活链路**：Toast 通知 → `claude-focus://` 协议 → VBS 包装器（隐藏控制台窗口）→ node `--focus` 模式 → Win32 `SetForegroundWindow`，这条链路中任何一环改动都需要整体验证
- **配置通过命令行参数传入**（如 `--notify-when-focused`），不使用独立配置文件
