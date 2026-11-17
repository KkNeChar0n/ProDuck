# 首批 PRD 技能适配清单

盘点日期：2026-11-17。只读检查了本机 prd-feishu、prd-feishu-edit 的说明、Python 脚本和导入关系，未执行发布脚本，未读取凭证。

| 能力 / 依赖 | 现有实现 | Produck 首批适配 |
| --- | --- | --- |
| 工作流说明 | SKILL.md 和 references 相对资源 | 保留原型先行、差异评审和版本固定的流程语义 |
| 首次发布 | publish.py，requests、beautifulsoup4 | 由 TypeScript 飞书适配器承接文档转换、发布与读回 |
| 局部修改 | edit.py，requests，依赖同级 prd-feishu 模块 | 原生章节差异与实时指纹检查，按阶段记录结果 |
| 共用原型 | shared_prototype.py，requests | 原生附件适配器维护迭代父节点的唯一附件 |
| 云效状态 | aliyuncs_status.py；延迟导入 alibabacloud_devops20210625、alibabacloud_tea_openapi | 云效适配器注入项目凭证和可配置状态映射 |
| 旧版截图 | 固定路径系统 Chrome、subprocess；macOS sips；可选 Pillow | 改为随应用 Chromium 截取已批准原型状态 |
| 飞书凭证 | ~/.prd-feishu/config.json，模块导入时读取 | 系统钥匙串和项目连接，不继承本机全局配置 |
| 云效凭证与项目 | 向父目录搜索 .aliyuncs.json | 限定当前项目配置，不扫描其他工作空间 |
| 工具宿主 | Read/Write/Bash/AskUserQuestion/Agent 等 | 文件、问答、浏览器和平台工具按能力映射；Agent 委派不默认兼容 |

## 首批实现决定

内置两个工作流采用原生 TypeScript 工具承接，不直接打包现有 Python 发布脚本，因此这两个内置工作流不需要系统 Python、系统 Chrome、sips 或 Agent CLI。保留可扩展 Skill 工具接口，不为未验证的第三方技能提前引入完整 Python 发行版。

第三方脚本技能按实际依赖报告兼容性；Node 脚本也不得默认获得无限文件和网络权限。只有明确选入分发清单并验证后，才随包提供额外运行时和依赖。

## 许可与分发边界

两个技能目录内未发现 LICENSE 文件，SKILL.md 未提供足以证明脚本可公开再分发的许可条款。首版按用户要求参考流程并独立实现，不把现有技能脚本复制进公开仓库。若后续直接分发原脚本，先核对其许可与来源。

Electron、React、TypeScript 和平台 SDK 的具体版本及依赖许可应在依赖锁定后生成安装包许可清单；本盘点不代替发布许可审查。

## 验收

任务 1.5 已完成依赖与许可盘点、原生工具适配选择。并不表示任务 7 的技能运行器或第三方兼容性已经实现。
