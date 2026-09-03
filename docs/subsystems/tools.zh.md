# macOS-use 工具运行时集成

[English](tools.md) | 中文

该独立插件会向 Harness 工具运行时添加三个能力服务与一个面向模型的工具消费方：

- `ctx.macosUse` 提供原生桌面观察与操作。
- `ctx.browserUse` 为每个 Harness Agent 提供隔离的托管 Chromium 上下文和页面。
- `ctx.guiModel` 把截图与任务转换为一个经过校验的动作。
- `@deepseek-ai/dsh-tool-macos-use` 注册 21 个工具及其安全、超时、附件、设置与展示策略。

匹配的 Harness 兼容性补丁会把全部三个服务映射到上游 `docs/subsystems/tools.md` 生成的 Cordis 参考文档。它还会把工具 schema 加入生成的工具目录，并把可视化卡片与任务渲染器加入生成的客户端插槽目录。

如需了解边界，请参阅[架构决策](../architecture.zh.md)；如需了解配置与行为，请参阅[工具包参考](../../packages/macos-use/tool-macos-use/README.zh.md)。
