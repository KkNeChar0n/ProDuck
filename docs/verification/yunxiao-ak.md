# 云效 AccessKey 接入验证

2026-11-23，Produck 0.1.15。

新云效连接默认使用 AK；既有未标记 authType 的配置继续按 PAT 解释。项目设置提供认证方式、AccessKey ID 和 Secret。AK 成对保存到钥匙串，数据库与界面回显只有凭证存在标记，不保存 AK 明文。修改任一 AK 字段时必须重新填写完整配对；切换认证方式禁止沿用另一种凭证。修改未保存时禁用连接测试。

AK 使用固定端点 devops.cn-hangzhou.aliyuncs.com，API 版本 2021-06-25，ACS3-HMAC-SHA256 签名；Node 内置 crypto 实现，无新增系统依赖。接口依据为官方已安装 SDK 的请求定义，并用官方 SDK 生成固定签名样例对照。未复制原产品技能脚本。

- GetProjectInfo：校验项目和组织标识、正常状态，返回项目名称。
- GetWorkItemInfo：校验内部工作项标识、项目归属及正常状态，映射状态标识。
- GetWorkItemWorkFlowInfo：基于实际工作项读取状态列表。
- UpdateWorkItem：POST 仅携带 identifier、fieldType=status、propertyKey=status、propertyValue。收到 success=false 或请求失败时不宣称成功。更新后走原同步流程读回，发送意图先落盘，不自动重发。

官方 API 入口：

- https://api.aliyun.com/api/devops/2021-06-25/GetProjectInfo
- https://api.aliyun.com/api/devops/2021-06-25/GetWorkItemInfo
- https://api.aliyun.com/api/devops/2021-06-25/GetWorkItemWorkFlowInfo
- https://api.aliyun.com/api/devops/2021-06-25/UpdateWorkItem

已验证：

- 90 项测试中 89 通过，1 原生 Python 沙箱专项默认跳过。新增签名对照、消息体变化、跨项目拒绝、失败与超时不重发、凭证轮换/存储及认证切换测试；原 PAT 与同步恢复测试继续通过。
- Electron 模拟闭环通过 AK 签名读取项目、工作项和状态列表，执行一次显式确认的状态更新，再次核对不重发。飞书发布记录保持独立。
- 使用用户指定项目已有 AK 对真实端点执行 GET，读取“证书自动化SaaS”项目与当前迭代工作项及工作流，标识均匹配；观察到正常状态字段为 NORMAL。旧 JSON 首条历史需求属于其他项目，被正确拒绝，改用匹配当前迭代的工作项完成读取。
- 真实工作流包括待处理、设计中、待开发、开发中、测试中、已完成、已取消。没有执行真实状态写入，没有把本地凭证导入仓库或测试包。

支持范围：长期 AK ID/Secret、杭州云效 2021-06-25 API；本次未扩展 STS 临时凭证。真实只读验证不能替代任务 8.3 的飞书发布及云效写入验收。

0.1.15 DMG 提取副本在无系统 CLI 环境通过 AK 模拟闭环，1942 个运行资源在执行前后哈希一致。安装包仍为 ad-hoc 测试包，未公证。
