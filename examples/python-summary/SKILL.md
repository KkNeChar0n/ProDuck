---
name: python-status-summary
description: 汇总输入中的需求状态，并输出 Markdown 文件。
---

在 Produck 的 Skills 页面导入此目录。脚本只使用标准库；读取 JSON 标准输入，在独立结果目录生成 summary.md。

输入示例：

```json
{"items":[{"title":"客户筛选","status":"设计中"},{"title":"导出","status":"待确认"}]}
```

在 Skills 页运行并逐次授权。此技能不连接平台，也不修改项目原型或文档。
