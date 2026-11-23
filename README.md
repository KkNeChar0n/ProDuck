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
- 受控 Agent 多步骤任务、逐项敏感操作批准、取消与中断恢复；可读取资料/记忆、保存笔记和操作网页。
- 说明型 Skill 导入、相对资源与版本指纹校验、兼容性报告；脚本和未适配宿主工具明确阻止运行。
- 模型文本/图像/原生工具能力检测，原型元素 ID 保持、基础表单状态恢复及人工交互检查记录。
- 飞书自建应用 / 云效 AK 与 PAT 配置、项目隔离钥匙串凭证及只读连接测试；可配置云效状态 ID 映射，首次发布成功后可核对工作项并同步状态。
- 发布前本地审阅包：固定正文、截图和批准原型，核对飞书父节点，绑定材料指纹；确认材料不会执行发布。
- 飞书首次发布：单独确认后创建需求子文档、维护共用原型附件、上传截图并读回校验正文及文件；保存阶段收据，结果不明时阻止盲目重试。
- 已发布 PRD 的线上读取、普通文字章节定位和增删差异评审；批准前重新读回检查冲突，尚不执行线上合并。
- 隔离 IPC、原型网络限制、本地 SQLite schema 和原子文件存储。

## 项目与产品版本

先创建项目、配置模型，再点击左侧“当前版本”旁的 ＋ 创建产品版本（如 V1.0.0）。点击版本右侧齿轮，在“版本设置”填写本次迭代的飞书知识库父节点地址，然后在此版本中制作原型和撰写 PRD。

项目右侧齿轮打开项目设置，版本右侧齿轮打开版本设置。项目共享模型、工作空间、飞书应用凭证、云效项目连接、资料记忆与技能；版本独立保存原型、截图、文档、审批、任务与交付记录。“版本设置”可复制同项目旧原型为未批准候选，需重新检查并通过。切换版本不改变已启动任务的归属。

升级时旧项目成果自动归入“默认版本”，原文件路径、批准和收据保持不变；旧飞书迭代地址只归入该默认版本。新版本须独立填写迭代地址。数据库升级前自动备份，旧版应用不能打开升级后的数据库。详见 [版本隔离验证](docs/verification/project-releases.md)。

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

飞书首次发布已接入（模拟平台验证通过，真实租户待联调）；云效状态同步已接入（模拟平台验证）；线上差异合并按用户选择暂缓，已支持受限标准库 Python 技能；任意第三方依赖、干净机器验收尚未完成。详见 [原型验证记录](docs/verification/prototype-workflow.md) 和 [Agent/Skill 验证记录](docs/verification/agent-skills.md)、[平台连接验证记录](docs/verification/platform-connections.md)、[首次发布验证记录](docs/verification/feishu-publication.md)、[文档差异验证记录](docs/verification/document-diff.md)。

## macOS 开发测试包

```sh
npm run package:mac
```

输出 `release/Produck-0.1.15-arm64-test.dmg`，包含 Electron、编译后的钥匙串程序与应用资源。目标最低系统为 macOS 13，当前只在 macOS 26.3 arm64 上构建和检查；尚未在最低系统或无开发工具的机器完成验收。

包使用临时签名，未完成 Developer ID 签名和公证，不用于公开分发。安装包未提交 Git；第三方运行组件许可证随包保存。打包验证不代表真实模型与平台集成已通过。

内置工作流入口位于 Skills 页面，包含原型制作、PRD 首次发布和只读差异评审。详见 [内置工作流范围](docs/verification/builtin-workflows.md) 与 [平台恢复验证](docs/verification/platform-recovery.md)。

工作流页现可选择“内置 · 原型制作”和“内置 · PRD 草稿”。Agent 可查看项目成果，在逐步批准后生成候选/草稿；原型通过、文档发布和平台状态更新仍在原有界面独立确认。

“内置 · 发布与差异准备”可由 Agent 准备发布审阅包、线上章节差异及云效同步计划，回到文档页继续审阅。批准、发布与状态写入仍通过独立界面确认；飞书原文合并暂缓。

安装包自带运行资源清单，可运行 `npm run test:packaged` 验证 DMG 提取副本的资源哈希及无 CLI 模拟闭环。详情见 [随包运行时验证](docs/verification/packaged-runtime.md)。

已支持声明式标准库 Python Skill，运行时随安装包提供。导入 [Python 汇总示例](examples/python-summary)，在 Skills 页填写 JSON 并逐次授权运行；文件和网络范围、依赖限制见 [Python 技能说明](docs/verification/python-skills.md)。

当前功能边界、剩余验收条件与记录模板集中在 [首版验收清单](docs/verification/release-readiness.md)。运行组件许可扫描记录可通过 `node scripts/audit-runtime-licenses.mjs` 更新；已补充对应 Python 完整构建元数据引用的原生组件许可文本，正式签名与公证仍待完成。

云效连接新配置默认选择 AccessKey（AK）：填写 AccessKey ID 与 Secret 后保存，二者均进入系统钥匙串。原 PAT 配置继续可用；切换认证方式需要重新填写凭证。AK 使用官方 2021-06-25 API 的杭州端点，无需安装 SDK 或 CLI。详见 [AK 验证记录](docs/verification/yunxiao-ak.md)。
