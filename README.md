# Produck

面向产品经理的 macOS Agent：理解页面、调整可操作原型、撰写需求文档并推进工作流。

当前处于 MVP 实施阶段。已生成 arm64 本地开发测试包，尚不是完整或可公开分发的 Agent。

## 已有成果

- [OpenSpec 提案与设计](openspec/changes/produck-mvp/)
- [可操作工作台原型](prototypes/produck-workbench/index.html)：米白色三栏布局，项目/模型配置演示、页面交互、示例 prompt 修改、版本确认与文档流程。
- 已接入真实项目状态的 Electron + React + TypeScript 工作台：创建与切换项目、独立工作空间、连接地址及资料导入。
- 项目级模型配置、macOS 钥匙串凭证、连接测试与流式文本问答；支持 OpenAI-compatible 和 Anthropic 文本协议。
- 项目隔离浏览器、网页文字/结构/样式/截图采集，有来源的记忆与确认冲突展示。
- 单文件模拟原型生成、页面 prompt 修改、带 ID 的元素选择、版本确认/恢复/源文件对比、失败任务显式重试。
- 根据批准版本保存状态截图、生成本地 PRD 草稿并导出含截图 HTML；未批准候选不能进入文档流程。
- 隔离 IPC、原型网络限制、本地 SQLite schema 和原子文件存储。

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
npm run test:workbench

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

`src/agent`、`src/prototypes`、`src/workflows` 和 `src/integrations` 分别承载模型生成、版本管理、本地文档和凭证能力。

## 进度和限制

[任务清单](openspec/changes/produck-mvp/tasks.md) 按验证结果勾选。界面已获用户确认；模型与原型、PRD 流程通过本地模拟 API 测试。用户已要求暂时跳过真实模型验证，因此重建视觉与交互质量未验收。普通问答仍为独立请求，不保存对话历史。

飞书/云效发布、完整技能运行器、通用 Agent 工具循环和干净机器验收尚未完成。详见 [本次验证记录](docs/verification/prototype-workflow.md)。

## macOS 开发测试包

```sh
npm run package:mac
```

输出 `release/Produck-0.1.0-arm64-test.dmg`，包含 Electron、编译后的钥匙串程序与应用资源。目标最低系统为 macOS 13，当前只在 macOS 26.3 arm64 上构建和检查；尚未在最低系统或无开发工具的机器完成验收。

包使用临时签名，未完成 Developer ID 签名和公证，不用于公开分发。安装包未提交 Git；第三方运行组件许可证随包保存。打包验证不代表真实模型与平台集成已通过。
