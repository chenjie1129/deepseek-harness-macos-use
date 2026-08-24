# macos-use

[English](README.md) | 中文

“Mac OS Use Agent Tools”是一组能力接缝包，让智能体通过 macOS API、GUI 自动化和真实受控浏览器直接操作本地计算机，而不再只依赖文件系统和 shell。

| 包 | `ctx` 键 | 角色 |
|---|---|---|
| [`macos-use`](macos-use/README.md) | `macosUse` | 截图、System Events GUI 自动化、应用启动与 AppleScript |
| [`gui-model`](gui-model/README.md) | `guiModel` | 调用已配置的 OpenAI 兼容视觉端点，根据截图选择下一步 GUI 动作 |
| [`browser-use`](browser-use/README.md) | `browserUse` | 运行 Playwright 驱动的 Chromium 标签页，支持选择器与坐标操作 |
| [`tool-macos-use`](tool-macos-use/README.md) | — | 注册面向模型的基础工具以及 `computer_use_task` / `browser_use_task` 循环 |

## 可视化配置

所有可调整的 GUI 智能体设置都位于常规的**插件配置**页面。GUI 模型卡片管理凭据、兼容 OpenAI 的端点、模型名称与响应预算；macOS Use 卡片管理任务及命令超时、步骤与无障碍元素预算、Chromium 无头模式、应用允许/拒绝列表、确认开关、单任务锁、截图展示与排除列表，以及立即中止控制。修改会实时生效，无需编辑 YAML 或重启。

每步截图开关默认开启，会在每个 `computer_use_task` 或 `browser_use_task` 步骤结果旁显示该步使用的截图；关闭后不会保存或显示这些截图。全屏截图在存储或交给视觉模型前，会遮盖截图排除列表中应用所属的窗口。

当 Retina 或大尺寸浏览器截图超过当前附件限制时，插件会自动缩小用于存储的副本。GUI 操作仍由原始像素定位；只有持久展示副本会被规范化。

## P0 可靠性与安全

桌面接缝可枚举应用和窗口、捕获精确窗口、扁平化前台窗口的无障碍树、聚焦指定窗口，并执行移动、点击、拖拽、输入、按键和滚动。语义快照会签发不透明元素令牌；坐标工具可使用令牌而非原始坐标，并在更新快照或窗口几何变化后拒绝旧令牌。

桌面动作执行实时应用策略：拒绝列表始终优先，非空允许列表只允许其成员。任意 AppleScript、拖拽、破坏性按键组合和破坏性自主任务可要求用户明确确认。默认同一时间只运行一个自主 GUI 任务，每个任务都有总超时，可视化紧急停止会立即中止活动任务。

## 已知限制与后续工作

- 自主任务循环仍需配置视觉模型；基础与语义工具不需要视觉模型。
- 桌面自动化需要为宿主进程授予“辅助功能”权限，截图需要在“系统设置”中授予“屏幕录制”权限。
- 浏览器自动化要求另行安装 Playwright Chromium：`pnpm exec playwright install chromium`。
