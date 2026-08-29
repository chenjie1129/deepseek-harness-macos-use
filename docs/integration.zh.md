# Harness 集成指南

[English](integration.md) | 中文

## 支持的基线

随附的 [`deepseek-harness-v0.1.2-alpha.1.patch`](../integration/deepseek-harness-v0.1.2-alpha.1.patch) 面向 DeepSeek Harness 提交 `cd5ef8148158c3a752a658978873241fdf8e2bbc`（`0.1.2-alpha.1`）。应用前请先运行 `git apply --check`。其他 Harness 版本需要重新做兼容性检查，因为客户端 slot、附件引用、包闭包、项目引用和锁文件都可能变化。

## 补丁接入的内容

补丁会把四个包注册到 CLI／运行时闭包和 TypeScript 项目引用中，让工具包加载其浏览器客户端，授权 `tool/result.data.meta.content` 所引用的仅 UI 结果图片，并把这些图片随 Session 导出；它还会更新锁文件、第三方声明，并为附件决策加入同步的 Agent Note。客户端包会把 GUI 模型与 GUI 智能体配置卡注册到 `settings.plugin.item`，并把两个任务渲染器注册到 `tool.call.toolview`。

补丁不会重复包含包源码。请在应用补丁前或之后，把 `packages/macos-use` 复制到 Harness 工作区。

## GUI 模型设置

打开**设置 → 插件 → 插件配置 → GUI 模型**。页面提供 API Key 环境变量、端点、模型和最大响应 token 的可视化字段。等价的部署表示为：

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY
  baseURL: https://api.example.com/v1
  model: your-vision-model
  maxOutputTokens: 512
```

`baseURL` 和 `model` 必填，服务会在基础 URL 后追加 `/chat/completions`。请优先通过 `apiKeyEnv` 引用凭据，不要提交明文 API Key。保存后变更会实时应用。

## 桌面与浏览器设置

打开**设置 → 插件 → 插件配置 → GUI 智能体**可设置全部 P0 智能体选项。可视化卡片包含：

- 可靠性：最大步骤数、任务总超时、macOS 命令超时、每个窗口快照的语义元素上限，以及浏览器有头／无头模式；
- 安全：应用允许列表、应用拒绝列表、AppleScript 一次性确认、破坏性动作确认和单活动任务锁；
- 截图与隐私：默认开启的**显示每步截图**开关，以及永不捕获其窗口的应用列表；
- 立即生效的**中止活动任务**紧急停止。

保存的配置会实时应用到 `macos-use`、`browser-use` 和 `tool-macos-use`。截图开关默认为 `true`；开启时，每个存在的任务步骤截图都会被保存并随该步输出显示。关闭后会省略每步图片，但保留 GUI 模型私下用于定位的截图和最终截图引用。

基础、每步和最终截图进入持久存储前，`tool-macos-use` 会在当前附件字节、像素总数或单边尺寸限制要求时缩小一份副本。GUI 模型仍接收原始截图，因此动作坐标不会改变。

请在集成后的 Harness 工作区安装 Chromium：

```bash
corepack pnpm exec playwright install chromium
```

需要给启动 Harness 的进程授予“辅助功能”和“屏幕录制”权限。截图像素坐标与 macOS 屏幕点之间尚未针对 Retina 或多显示器布局自动换算。

## 安全边界

插件可以执行任意 AppleScript，并控制桌面和浏览器界面。拒绝列表优先于允许列表。被排除应用的窗口会在全屏截图中被遮盖，针对它们的精确窗口截图会直接失败。默认开启的一次性确认覆盖任意 AppleScript、拖动、破坏性按键和破坏性任务意图。元素令牌仅能使用到下一次语义快照或源窗口几何变化为止。插件本身不会授予或持久化操作系统权限。GUI 模型截图与中间决策不会成为独立持久化 Session 事件。启用的每步图片会作为最终工具结果中的、经过授权的仅 UI 展示附件保存，并随 Session 导出；驱动模型仍然只接收文本。

## 已完成的验证

在支持的基线上，59 项插件测试与 98 项插件加 Harness 附件聚焦测试均通过。GUI 套件通过 3,822 项测试并跳过 1 项，生产 Web 构建通过。原生 JXA／AppKit／CoreGraphics／System Events 脚本也都编译成功。干净 profile 的浏览器检查通过确定性的本地驱动与视觉端点以及真实 macOS 截图服务运行 `computer_use_task`。任务成功完成，保存的 `computer-use-task-step-1.png` 通过会话附件线路加载，并由 Harness 内联渲染在第 1 步；浏览器没有 warning 或 error。同一次检查验证了默认开启的开关与 GUI 模型和 GUI 智能体卡中的全部 P0 控件。未执行真实第三方提供方运行。
