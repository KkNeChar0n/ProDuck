# 云效状态同步验证

2026-11-18，Produck 0.1.6。

支持云效中心版 PAT。已完整发布且读回的飞书文档可输入云效内部工作项 ID，读取标题、所属项目、当前状态与工作流状态列表，按项目配置的 published 映射准备同步。原生确认框显示明确对象和状态变化；仅 PUT status 字段，随后 GET 核对。状态映射不会从“文档已发布”推断“需求已完成”。工作流列表仅证明状态存在，具体流转权限由服务端执行时判定。

收据位于项目 workflows/yunxiao-sync.json，记录发布引用、远端对象 ID、配置及计划指纹、发送意图、阶段时间与读回结果。发送意图先持久化；请求失败、超时或重启后只读回，不自动重发。读回不符保留待核对状态；飞书发布记录保持独立。配置改变后旧确认失效，需人工检查旧请求结果。读前状态核对不是远端锁，不能保证排除最后一次读取后的并发状态变动。

验证：

- 全量 70 项自动化测试通过，其中 9 项云效测试覆盖成功、空映射、未完成发布、跨项目/归档、目标不存在、配置与状态变化、丢失响应恢复、读回不符、重复计划及已达到目标零写入。
- Electron 隔离桌面测试通过：模拟发布后从界面读取并准备同步，原生确认、写入、读回，再次核对；断言 PUT 总计一次、飞书节点数量不增加，收据为 synced。
- 类型检查、构建、格式检查通过。
- 桌面截图：desktop-yunxiao.png。

验证使用合成凭证和内存模拟平台，没有访问真实云效租户。真实平台端到端验收属于任务 8.3，仍未完成。原文合并依用户选择暂缓，当前只支持首次发布后的状态同步。

官方接口依据：

- https://help.aliyun.com/zh/yunxiao/developer-reference/updateworkitem
- https://help.aliyun.com/en/yunxiao/developer-reference/getworkitem
- https://help.aliyun.com/en/yunxiao/developer-reference/getworkitemworkflow-get-a-list-of-the-status-of-the-work-item

安装包：release/Produck-0.1.6-arm64-test.dmg，hdiutil verify 校验通过。仍为 ad-hoc 签名测试包，未公证，未完成干净机器验收。
