# Harness 集成指南

[English](integration.md) | 中文

## 支持的基线

已经证明的源码集成基线是 DeepSeek Harness 提交 `cd5ef8148158c3a752a658978873241fdf8e2bbc`（`0.1.2-alpha.1`）。随附的 [`deepseek-harness-v0.1.2-alpha.1.patch`](../integration/deepseek-harness-v0.1.2-alpha.1.patch) 面向这个精确提交。应用前请先运行 `git apply --check`。其他 Harness 版本需要重新做兼容性检查，因为设置 API、客户端 slot、附件引用、包闭包、项目引用和锁文件都可能变化。

上游此后发布了 [`0.1.2-alpha.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5)。适配器代码遵循它公开的 Settings／Session 方向，但在精确 alpha.5 源码通过编译、构建、启动与聚焦集成门禁前，alpha.5 兼容性仍未验证。

## 推荐的仅挂载 profile

如果兼容 Harness 工作区已经安装或链接这四个包，可以在部署 YAML 中不放任何智能体选项，仅挂载能力。请从 Harness 根目录运行：

```bash
plugin_root=/absolute/path/to/deepseek-harness-macos-use
export DSH_HOME="$(mktemp -d /private/tmp/dsh-macos-profile.XXXXXX)"
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml" --dump-config
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml"
```

`--dump-config` 预检必须显示 `macos-use`、`browser-use`、`gui-model` 与 `tool-macos-use` 四个服务 ID。[`macos-use.cordis.patch.yml`](../integration/macos-use.cordis.patch.yml) 只包含这四项挂载，**可调键为零**。请在**设置 → 插件 → 插件配置**页面中可视化完成全部智能体配置，后续启动继续使用同一个 `DSH_HOME`。

当兼容 Harness 工作区尚未包含或无法解析这些包时，下面的源码复制补丁仍是开发者集成路径。

## 补丁接入的内容

补丁会把四个包注册到 CLI／运行时闭包和 TypeScript 项目引用中，让工具包加载其浏览器客户端，授权 `tool/result.data.meta.content` 所引用的仅 UI 结果图片，并把这些图片随 Session 导出；它还会更新锁文件、第三方声明，并为附件决策加入同步的 Agent Note。客户端包会把 GUI 模型与 GUI 智能体配置卡注册到 `settings.plugin.item`，并把两个任务渲染器注册到 `tool.call.toolview`。

补丁不会重复包含包源码。请在应用补丁前或之后，把 `packages/macos-use` 复制到 Harness 工作区。

## GUI 模型设置

打开**设置 → 插件 → 插件配置 → GUI 模型**。页面提供由 Harness 凭据服务保存的 Secret 字段，以及凭据引用、端点、模型和最大响应 token 的可视化字段。请只在这张可视化卡片上配置这些值；包组合只负责挂载能力，无需重复任何可调智能体设置。

全新安装可以把 `baseURL` 和 `model` 留空，以便先渲染配置卡；但在两者完成配置前，每个模型请求都会默认拒绝。服务会在基础 URL 后追加 `/chat/completions`。端点会拒绝内嵌凭据、查询参数、片段、非环回 HTTP 和重定向，避免截图与凭据经远程明文连接发送，或被转发到未配置的主机；本地模型服务仍可使用环回 HTTP。请使用可视化 Secret 字段或 `apiKeyEnv` 凭据引用，不要提交明文 API Key。无效值会在持久化前被拒绝，有效变更保存后实时应用。

## 桌面与浏览器设置

打开**设置 → 插件 → 插件配置 → GUI 智能体**可设置全部 P0 智能体选项。可视化卡片包含：

- 可靠性：最大步骤数、任务总超时、macOS 命令超时和每个窗口快照的语义元素上限；
- 浏览器：有头／无头模式、允许域名、拒绝域名和独立的私有网络开关；
- 安全：精确的应用读取授权、控制授权、精确拒绝规则、旧版名称列表、破坏性动作确认、默认开启的每次 GUI 变更确认和单活动任务锁；
- 截图与隐私：默认开启的**显示每步截图**开关，以及永不捕获其窗口的应用列表；
- 作用于全局的**中止所有活动 GUI 任务**紧急停止；普通设置正在保存时，该按钮仍可用。

保存的配置会实时应用到 `macos-use`、`browser-use` 和 `tool-macos-use`。应用和浏览器授权为空时默认拒绝。精确应用规则每行一条，例如 `bundleId=com.apple.TextEdit`、`name=TextEdit | bundleId=com.apple.TextEdit` 或 `pid=123`；格式错误或字段重复会拒绝保存。每条控制规则都必须被相同或更宽泛的读取规则覆盖，确保成功变更总能产生动作后回执。截图开关默认为 `true`；开启时，每个存在的任务步骤截图都会被保存并随该步输出显示，插件能够捕获的停止／错误结果也一样。关闭后会省略每步图片，但保留 GUI 模型私下用于定位的截图和最终截图引用。

从用户视角，保存是事务性的：普通设置与凭据操作会作为同一计划接受校验；写入失败时页面仍保持未保存状态，不会误报成功。把继承的文本设置清空会保存显式空值；只有**重置**会删除覆盖值并重新允许继承。

基础、每步和最终截图进入持久存储前，`tool-macos-use` 会在当前附件字节、像素总数或单边尺寸限制要求时缩小一份副本。GUI 模型仍接收原始截图，因此动作坐标不会改变。

请在集成后的 Harness 工作区安装 Chromium：

```bash
corepack pnpm exec playwright install chromium
```

需要给启动 Harness 的进程授予“辅助功能”和“屏幕录制”权限。显示器坐标截图绝不会捕获完整显示器：服务只把经过精确授权的前台窗口 id 传给原生截图命令，再把这些像素合成到其余为黑色、具有主显示器坐标几何的画布上。新鲜观察通过校验后，PNG 像素坐标才会转换成全局 macOS point，包括 Retina 1×／2× 和主显示器非零原点。被排除、不可读、位于副显示器、跨屏、部分超出或捕获期间变化的前台窗口，会在返回可传输像素前被拒绝。

### Ego Lite 后端（实验性）

在 GUI 智能体设置卡片中把 `browserBackend` 设为 `ego`，即可使用 ego lite 浏览器代替 Playwright。这需要先安装 [ego lite 应用](https://github.com/citrolabs/ego-lite)，并确保 `ego-browser` CLI 位于 PATH 中。

**该后端不具备默认 Playwright 后端的固定代理网络隔离能力。** 仅在受信任的网络上启用它，并配合严格限定范围的域名授权。完整风险说明请参见 [architecture.md](architecture.zh.md#实验性-ego-lite-后端)。

启用 `ego` 时，只有基于选择器的浏览器工具（`browser_navigate`、`browser_click`、`browser_fill`、`browser_extract_text`、`browser_screenshot`）可用。`browser_use_task` 自主循环与坐标动作不受支持。

## 安全边界

插件不暴露调用方自定义的任意 AppleScript；内部原生脚本会把最后一次目标校验与输入事件绑定在一起。应用拒绝规则优先于授权。背景窗口、桌面、菜单、覆盖层和其他应用绝不会进入显示器坐标 raster，因此不依赖事后遮盖；针对被排除内容的精确窗口截图会直接失败。每个直接或模型选择的 GUI 变更动作前的一次性确认默认开启。只有当部署提供等效、可信的安全或审批边界时，才应关闭它。关闭后，按配置启用的启发式确认仍会覆盖部分破坏性拖动、按键与任务措辞，但它不是语义效果保证。

桌面与浏览器观察都绑定 owner、只能使用一次并会过期；它们会在异步复查前同步占用，避免并发重放造成重复变更。原生变更从最终复查到分派共用服务级队列与 epoch，因此任一已分派变更都会使其他所有待用桌面观察失效。每个 Agent 使用隔离的浏览器上下文；每个截图坐标令牌还绑定视口摘要，必须在分派前立即与新鲜截图一致。导航、重定向、子资源与 WebSocket 被强制送入使用随机凭据的环回代理。每条出站连接都会重新校验原始主机名、执行一次 DNS 解析；除非已启用私有网络，只要答案集存在任一非公网地址就整体拒绝；随后把 socket 固定到数字 IP，并保留 Host 与 TLS SNI。Chromium DNS 退路、隐式环回绕过、QUIC、Service／Dedicated／Shared Worker、WebRTC 与 WebTransport 都会被禁用。这关闭了已知的浏览器内 DNS rebinding 路径，但仍是纵深防御，不是操作系统网络沙箱。进行中取消会只关闭当前 Agent 的上下文。插件本身不会授予或持久化操作系统权限。

不受支持、格式错误、超限、过期或其他无法可靠判断的模型动作会停止任务，不会退化为猜测动作。只有在新鲜、原子的浏览器或 macOS 完成快照上验证请求的宿主侧后置条件后，任务才能报告完成。面向用户的进度与持久任务历史会把 `type` 文本载荷替换为字符数占位符；这项输出脱敏不会遮盖截图像素中原本可见的文字。GUI 模型截图与中间决策不会成为独立持久化 Session 事件。启用的每步图片会作为最终工具结果中的、经过授权的仅 UI 展示附件保存，并随 Session 导出；驱动模型仍然只接收文本。

## 已完成的验证

在当前源码冻结点，插件 Vitest 门禁在 **23 个文件中通过 346 项测试**，Host 与 Client TypeScript 项目以及完整集成 Harness 构建也在支持的 alpha.1 基线上通过。逻辑门禁覆盖设置持久化、可视化配置卡注册、默认拒绝策略、提供方边界、观察归属与清理、浏览器隔离、原生动作保护、原子完成校验、键入文本输出脱敏、进度边界、授权附件元数据，以及截图开关默认开启／关闭路径。

独立的提示词评测器在 **8 个文件中通过 19 项测试**。它的确定性“提示词到浏览器”冒烟测试也通过了真实 Harness SDK／工具循环与 Playwright 路径，最终状态由独立 HTTP 判定器验证。

专用 Playwright Chromium 渲染夹具会打包实际的 `SettingsCards` 与 `GuiTaskView` 组件。它已验证所有可视化配置控件、两个默认开启的开关、开启状态有 1 张内联步骤图片、关闭状态为 0 张，以及无控制台、请求或水平溢出问题。

本轮发布证据不宣称已完成解锁原生 macOS 应用后的截图／动作 E2E、alpha.5 精确源码的编译／构建／启动，或真实第三方提供方运行。请将这些门禁与静态、逻辑、TypeScript 和组件渲染证据分开记录。
