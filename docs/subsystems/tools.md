# macOS-use tool runtime integration

English | [中文](tools.zh.md)

This standalone plugin adds three capability services and one model-facing tool consumer to the Harness tool runtime:

- `ctx.macosUse` provides native desktop observation and actions.
- `ctx.browserUse` provides an isolated managed Chromium context and page per Harness Agent.
- `ctx.guiModel` converts a screenshot and task into one validated action.
- `@deepseek-ai/dsh-tool-macos-use` registers 21 tools and their safety, timeout, attachment, settings, and presentation policy.

The matching Harness compatibility patch maps all three services to the upstream `docs/subsystems/tools.md` generated Cordis reference. It also adds the tool schemas to the generated tool catalog and the visual cards and task renderer to the generated client-slot catalog.

See the [architecture decision](../architecture.md) for boundaries and the [tool package reference](../../packages/macos-use/tool-macos-use/README.md) for configuration and behavior.
