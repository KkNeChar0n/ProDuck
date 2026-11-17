# Produck

面向产品经理的 macOS Agent：理解页面、调整可操作原型、撰写需求文档并推进工作流。

当前处于 MVP 实施阶段，尚未提供可用的正式 Agent 或安装包。

## 已有成果

- [OpenSpec 提案与设计](openspec/changes/produck-mvp/)
- [可操作工作台原型](prototypes/produck-workbench/index.html)：米白色三栏布局，项目/模型配置演示、页面交互、示例 prompt 修改、版本确认与文档流程。
- 已接入真实项目状态的 Electron + React + TypeScript 工作台：创建与切换项目、独立工作空间、连接地址及资料导入。
- 项目级模型配置、macOS 钥匙串凭证、连接测试与流式文本问答；支持 OpenAI-compatible 和 Anthropic 文本协议。
- 隔离 IPC、浏览器登录与采集技术验证、本地 SQLite schema 和原子文件存储。

## 体验界面原型

直接用浏览器打开 `prototypes/produck-workbench/index.html`，或运行：

```sh
npm run preview:prototype
```

访问 http://127.0.0.1:4173 。预览服务需要开发机 Python 3；这不是正式应用的用户依赖。

原型只使用内存模拟数据，刷新重置。使用 demo-token 测试配置，不要输入真实密钥。模拟浏览器不访问真实网站；自由 prompt、真实模型调用和平台发布尚未实现。

[体验与验证记录](docs/verification/prototype-review.md) · [桌面截图](docs/verification/workbench-desktop.png)

## 开发

开发机需要 Node.js 24.14+、npm、Xcode Command Line Tools（编译钥匙串程序），以及 macOS arm64。正式应用目标是安装后无需这些开发工具。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

```sh
# 使用独立临时 profile 和本地模拟网站验证 Electron
npm run test:browser-spike
npm run test:desktop

# 原型服务已启动且测试机安装 Python Playwright/Chromium 后
python3 tests/prototype_smoke.py
```

## 代码边界

- `src/desktop`：桌面生命周期、受控 preload、导航约束。
- `src/ui`：React 桌面界面。
- `src/contracts`：跨进程类型。
- `src/projects`：SQLite、原子文件和工作空间路径边界。
- `prototypes`：用户界面演示，与真实应用功能明确分开。
- `scripts`、`tests`：开发验证，不作为用户运行依赖。

后续按实际任务新增 Agent、原型、工作流与集成模块，不提前创建空模块或拆分微服务。

## 进度和限制

[任务清单](openspec/changes/produck-mvp/tasks.md) 按验收结果勾选。界面已获用户确认；模型调用已通过本地 API 联调，真实供应商连接待用户配置验证。当前每条提问独立发送，不保存对话历史。网页重建、平台集成、完整技能运行器和安装包仍未完成。

验证记录位于 [docs/verification](docs/verification/)。当前原型和技术探针的成功不等于完整 MVP 已可用。
