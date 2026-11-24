# 真实模型验收：原型与自主探索

2026-11-24，应用实现 0.1.20；模型 `gpt-6.1-sol`，通过用户已配置的兼容 API 调用。没有使用预设模型响应。凭证通过现有钥匙串服务使用，不打印或导出；读取用户模型配置，成果仅写入临时测试项目。

## 原型：首次失败，修改后交互通过

使用 `tests/fixtures/customers.html` 虚构客户页面，通过 Produck BrowserSurface 体验搜索、重置、新增弹窗与必填校验并采集；PrototypeGenerator 调用真实模型生成候选。模型输入为文字、结构和样式，截图仅用于本地核对。

首次候选的 `id=reset` 控件遮蔽了表单 `reset()` 方法，实际点击重置报错。同一方法用于新增后刷新，代码检查确认该路径也受影响。通过现有 PrototypeGenerator 修改流程，要求模型使用 `HTMLFormElement.prototype.reset.call(form)` 修复，生成独立候选，保留原版本。

修订后在真正的 Produck PrototypeSurface 中点击和输入，9 项全部通过：初始三行、名称搜索、重置、状态筛选、无匹配空态、打开弹窗、空表单必填校验、取消不新增、合法输入新增第四行并显示成功反馈。测试使用已检查候选的 DOM 选择器，不应视作任意模型输出的通用验收器。

视觉对照：首版基本保留页头、卡片、三列表格、绿白配色与控件位置；表格与卡片底部有少量间距差异。交互有合理但非原样的变化：原页原生校验改为行内错误，新增反馈改为浮层，新增成功会清空筛选条件。修订候选的校验与成功截图留存。没有进行像素级误差评分，也不代表用户已批准候选。

证据：

- [源页面](live-model/source.png)、[初次候选](live-model/prototype-initial.png)
- [必填校验](live-model/prototype-validation.png)、[新增成功](live-model/prototype-success.png)
- [修订后可操作 HTML](live-model/prototype.html)
- [首次失败与哈希](live-model/initial-result.json)、[修订版本与哈希](live-model/result.json)、[交互检查](live-model/interactions.json)

## 自主 Chrome：报告生成，完整流程未通过

同一真实模型通过 DiscoveryService 自主选择动作，独立 Chrome 访问同一虚构页面，预算 20 步，实际 19 个页面状态后结束并生成理解草稿。测试专用确认回调只允许本地夹具的操作，共确认 4 次；夹具无写入后端，仅修改内存数据。该回调不替代应用中的用户确认，也不验证真实业务写入权限。

已观察到名称搜索缩小结果、重置恢复列表、打开与取消新增弹窗。理解报告正确保留状态筛选、空态、明确校验与新增成功等未验证项；没有自动批准长期记忆。

实际暴露的问题：

1. 所有 submit 控件都被视为业务操作，搜索按钮首次执行后也被防重放规则拦截。应区分查询表单与业务提交，不能仅靠按钮类型，也不能仅信任模型声明。
2. 元素描述没有输入值、当前选项、required 与 validity，模型无法确认填入结果和原生必填校验。
3. 当前回车键事件在本夹具未触发表单提交；工具返回已执行不等于页面效果生效。
4. 业务防重放键按操作种类和目标标签记录；首次空表单尝试后填入新数据仍被拒绝，模型随后改用另一输入框回车尝试提交。应按表单及提交意图统一约束替代入口，并区分原生校验阻止和结果不明，不能简单放开重复提交。

这些问题尚未修改产品代码。优先补足观察与键盘回归，再调整查询/业务提交分类和跨入口防重放，并重新运行真实模型验收。当前证据不支持“完整自主浏览通过”的结论。

[逐步动作与结果](live-model/discovery.json)。本地完整报告位于 `outputs/live-discovery/understanding.md`，仍是未批准草稿。

## 复现

先构建，确保当前项目已保存可用模型；下列真实模型命令会产生模型用量：

```sh
npm run build
node scripts/run-electron.mjs scripts/live-prototype-check.cjs --connection-only
node scripts/run-electron.mjs scripts/live-prototype-check.cjs
node scripts/live-discovery-check.mjs --use-configured-model
```

原型输出在 `outputs/live-validation`。每次模型生成内容可能不同，先检查实际 DOM 再调整 `scripts/live-prototype-interactions.cjs` 的选择器，然后运行该 Electron 脚本。该脚本本轮针对已修订候选；不能拿新生成候选的检查结果覆盖本轮记录。自主探索的输出在 `outputs/live-discovery`。

本轮仅新增验收脚本与记录，安装包仍为 0.1.20，没有发布包含这些未修复问题修正的新包。
