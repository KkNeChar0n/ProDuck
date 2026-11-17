# 平台连接验证

2026-11-17；Produck 0.1.2；macOS arm64。

## 当前支持

- 项目设置中的飞书知识库连接：自建应用 App ID、App Secret、迭代父节点 wiki 地址。申请 tenant access token 后读取节点，校验节点标识、空间和 docx 类型。目标需为新版文档节点，应用需具备对应读取权限。
- 云效中心版：个人访问令牌（PAT）、组织 ID、项目 ID、项目地址。使用固定官方 API 域名读项目，校验返回项目 ID。当前不支持旧版 AccessKey 或 Region 版。
- 状态映射：首次发布/差异合并后的目标状态 ID，可留空；配置不验证状态是否适用于工作项，也不执行同步。后续同步需重新核对合法转换。
- 凭证只写入 macOS 钥匙串，SQLite 保存引用。更换飞书 App ID 必须重新输入 Secret；测试不跟随重定向，不向用户输入的文档地址发送密钥。只回显是否有凭证，保存后清空密钥输入框。
- 测试期间配置变化、鉴权失败、目标不匹配、无效响应均不能报告成功。服务端原始错误内容不回传，避免泄露敏感信息。原有只存地址入口不能覆盖已有鉴权配置。

## 验证

46 项单元测试、类型检查、生产构建通过。新增测试覆盖凭证轮换、项目隔离、数据库无密钥、旧配置保护、飞书请求及节点读回、云效 PAT 请求及项目校验、非法地址/标识、配置变化和错误信息。

Electron 原生桌面测试通过：UI 填写并保存虚构飞书配置，系统钥匙串保存，字段清空，另一个项目无配置，通过模拟响应显示父节点读取成功。截图为 `desktop-platforms.png`。测试使用独立 profile，结束删除测试钥匙串项；平台请求被测试传输层拦截，不访问真实平台。

## 尚未验证

没有使用真实飞书/云效凭证验证租户权限。连接成功仅说明读取可用，不代表发布、附件、状态转换可用。发布、差异合并、同步与远端中断恢复仍待实现，任务 6.3–6.8 保留未完成。真实模型验证继续按用户要求跳过。

## 官方接口依据

- 飞书获取节点：https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node
- 飞书自建应用鉴权：https://open.feishu.cn/document/ukTMukTMukTM/ukDNz4SO0MjL5QzM/auth-v3/auth/tenant_access_token_internal
- 云效 GetProject：https://help.aliyun.com/zh/yunxiao/developer-reference/getproject
- 云效中心版域名及令牌：https://help.aliyun.com/en/yunxiao/developer-reference/how-to-install-initialize-and-use-the-apsara-devops-cli
