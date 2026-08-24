# @deepseek-ai/dsh-tool-macos-use

[English](README.md) | 中文

`ctx.macosUse`、`ctx.guiModel` 与 `ctx.browserUse` 能力接缝的面向模型消费者。

## 工具

基础 macOS 工具包括 `computer_screenshot`、`computer_list_apps`、`computer_list_windows`、`computer_screenshot_window`、`computer_get_window_state`、`computer_click`、`computer_move`、`computer_drag`、`computer_type`、`computer_key`、`computer_scroll`、`computer_open_app`、`computer_focus_window`、`computer_run_applescript` 和 `computer_abort`。

基础浏览器工具包括 `browser_navigate`、`browser_click`、`browser_fill`、`browser_extract_text` 和 `browser_screenshot`。

`computer_use_task` 和 `browser_use_task` 会反复捕获截图、请求 `ctx.guiModel` 给出一个动作，并通过 `ctx.macosUse` 或 `ctx.browserUse` 执行，直到 GUI 模型回答 `done` 或步骤预算耗尽。每个任务结果都包含 `completed`、`summary`、动作与结果日志，以及持久的最终截图引用。默认情况下，面向用户的结果还会在每一步输出旁显示该步决策所用的截图。

## 配置

```yaml
config:
  defaultMaxSteps: 20
  taskTimeoutMs: 120000
  commandTimeoutMs: 15000
  maxElementsPerSnapshot: 250
  showStepScreenshots: true
  browserHeadless: true
  allowedApps: '' # comma/newline list
  deniedApps: '' # comma/newline list
  excludedScreenshotApps: | # comma/newline list
    Passwords
    1Password
    Keychain Access
  confirmAppleScript: true
  confirmDestructiveActions: true
  singleActiveTask: true
```

所有值都在插件配置页面实时管理。同一卡片还提供紧急停止按钮，可立即中止活动自主 GUI 任务。`showStepScreenshots` 默认值为 `true`；关闭后，每步截图不会被保存或显示，但 GUI 循环仍会在内部捕获屏幕供视觉模型使用。

`computer_get_window_state` 会为可操作的无障碍元素返回不透明令牌。`computer_click`、`computer_move` 和 `computer_drag` 可接受令牌并重新解析当前中心点。智能体获取更新语义快照，或来源窗口移动、缩放后，令牌即失效。

拒绝列表始终优先于允许列表。开启相应开关时，任意 AppleScript、拖拽、破坏性按键组合和破坏性任务意图会请求确认。单任务锁和超时限制自主循环；`computer_abort` 与可视化紧急停止可立即取消任务。

在保存基础、每步或最终截图前，工具会在需要时缩小一份副本，以满足当前附件存储的字节、像素总数和单边尺寸限制。GUI 定位仍使用原始截图，因此存储规范化不会改变桌面或浏览器操作所使用的坐标系。

## 模型体验

### 工具 schema

#### 模型看到的内容

驱动模型会看到生成的 [`computer_*`、`browser_*`、`computer_use_task` 与 `browser_use_task` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-macos-use)。GUI 提供方端点与凭据属于部署设置，不是模型参数。

#### Token 影响

包可见时，每个请求都会发送二十二个固定 schema；`defaultMaxSteps` 只会改变一个任务参数的说明。

#### KV 缓存影响

只要工具可见性、定义与解析后的默认步骤数不变，前缀就保持稳定。

### 工具结果

#### 模型看到的内容

基础截图会把 PNG 字节保存为持久 `ctx.attachments` 记录，但只把尺寸、字节数和附件 id 渲染为文本，因为主要的 DeepSeek 驱动适配器拒绝图片工具结果内容。任务结果会渲染 `Completed` 或 `Stopped`、摘要、每条动作与结果以及最终截图引用。启用 `showStepScreenshots` 时，独立的仅 UI 结果投影会把每条动作与结果和已保存图片配对；驱动模型不会收到这些像素。

#### Token 影响

基础确认文本很短。提取的浏览器文本和任务动作日志取决于数据，并保留在工具历史中直至压缩；`max_steps` 限制循环日志的增长。

#### KV 缓存影响

追加式结果文本位于可复用请求前缀之后，不会使之前的缓存项失效。

## 已知限制与后续工作

- GUI 模型请求与决策发生在驱动 Session 日志之外。启用的每步截图会作为最终工具结果中的持久 UI 展示元数据保存，而不是独立流式 Session 事件。
- 确认只对当前动作有效。插件不会创建持久权限，也不会替代 macOS 的辅助功能和屏幕录制控制。
- GUI 模型请求失败会中止任务工具；没有重试、恢复或局部持久子步骤记录。
- 无障碍元素质量因应用而异；没有有效边界的控件不能通过令牌定位。
