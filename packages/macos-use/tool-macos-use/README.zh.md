# @deepseek-ai/dsh-tool-macos-use

[English](README.md) | 中文

`ctx.macosUse`、`ctx.guiModel` 与 `ctx.browserUse` 能力接缝的面向模型消费者。

## 工具

基础 macOS 工具包括 `computer_screenshot`、`computer_click`、`computer_type`、`computer_key`、`computer_open_app` 和 `computer_run_applescript`。

基础浏览器工具包括 `browser_navigate`、`browser_click`、`browser_fill`、`browser_extract_text` 和 `browser_screenshot`。

`computer_use_task` 和 `browser_use_task` 会反复捕获截图、请求 `ctx.guiModel` 给出一个动作，并通过 `ctx.macosUse` 或 `ctx.browserUse` 执行，直到 GUI 模型回答 `done` 或步骤预算耗尽。每个任务结果都包含 `completed`、`summary`、动作与结果日志，以及持久的最终截图引用。

## 配置

```yaml
config:
  defaultMaxSteps: 20 # optional
```

## 模型体验

### 工具 schema

#### 模型看到的内容

驱动模型会看到在 [`src/index.ts`](src/index.ts) 中定义的 `computer_*`、`browser_*`、`computer_use_task` 与 `browser_use_task` schema。GUI 提供方端点与凭据属于部署设置，不是模型参数。

#### Token 影响

包可见时，每个请求都会发送十三个固定 schema；`defaultMaxSteps` 只会改变一个任务参数的说明。

#### KV 缓存影响

只要工具可见性、定义与解析后的默认步骤数不变，前缀就保持稳定。

### 工具结果

#### 模型看到的内容

基础截图会把 PNG 字节保存为持久 `ctx.attachments` 记录，但只把尺寸、字节数和附件 id 渲染为文本，因为主要的 DeepSeek 驱动适配器拒绝图片工具结果内容。任务结果会渲染 `Completed` 或 `Stopped`、摘要、每条动作与结果以及最终截图引用；驱动模型不会收到截图像素。

#### Token 影响

基础确认文本很短。提取的浏览器文本和任务动作日志取决于数据，并保留在工具历史中直至压缩；`max_steps` 限制循环日志的增长。

#### KV 缓存影响

追加式结果文本位于可复用请求前缀之后，不会使之前的缓存项失效。

## 已知限制与后续工作

- GUI 模型截图请求与决策发生在驱动 Session 日志之外；只有最终工具结果保留动作与结果摘要以及附件引用。
- `computer_run_applescript` 接受任意脚本源，所有桌面与浏览器操作依赖部署工具策略及宿主操作系统权限，而不是包专用批准层。
- GUI 模型请求失败会中止任务工具；没有重试、恢复或局部持久子步骤记录。
- 已有聚焦的工具循环测试，但组装模型快照与真实桌面或浏览器端到端套件留待后续实现。
