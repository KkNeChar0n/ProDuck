# Python Skill 运行范围

2026-11-19，Produck 0.1.11。用户选择优先 Python 脚本。

首批支持 macOS arm64、Python 3.12 标准库脚本。应用随包提供独立 CPython 3.12.16（python-build-standalone 20261110），下载来源和 SHA-256 固定在 scripts/python-runtime.json。构建时校验归档，不调用用户系统 Python；运行时使用 -I -S -B 隔离环境、禁用自动 site 加载和字节码写入。

技能目录包含 SKILL.md、包内 Python 入口及 produck-python.json。可直接导入 examples/python-summary 体验。声明要求：

```json
{
  "runtime": "python3.12",
  "entry": "main.py",
  "dependencies": [],
  "capabilities": { "read": "skill", "write": "output", "network": false }
}
```

入口禁止绝对路径与越界。依赖必须为空；requests、pandas、浏览器自动化、联网发布和系统命令等当前不支持，不自动安装。原 prd-feishu Python 脚本不在此兼容范围，其流程已由应用原生服务承接。

每次运行都在原生确认框显示名称、入口、版本指纹、读取/写入/网络范围和本次输入。执行前再次校验整个导入快照指纹。更新需重新导入，新版本不能沿用旧指纹；确认取消则不运行。普通 Agent 不执行 Python 技能。

运行时复制已验证技能快照到本次运行目录，使用 macOS sandbox-exec 默认拒绝配置。允许读取运行时、技能副本、结果目录及系统运行库；文件路径元信息与根目录本身可读，个人文件内容默认拒绝。仅允许写本次 output 子目录，禁止网络连接和 fork/其他可执行程序。缺少隔离设施时失败退出，不回退到无限权限执行。

每次输入限 16000 字节 JSON；墙钟时限 20 秒，CPU 10 秒；单文件上限 8 MB。宿主检查输出总量 16 MB、200 项、目录深度 16、拒绝符号链接/特殊文件；标准输出和错误合计最多 64000 字节。宿主采样内存超过 256 MB 时终止（采样保护，不是严格瞬时内存硬上限）。可取消运行，退出应用也停止当前脚本。

收据保存在项目 workflows/python-<id>/intent.json 和 result.json；脚本只能写 output。中断后没有自动重跑。此首版不提供历史收据列表，工作空间文件保留可供核对。

验证：

- 声明校验拒绝越界入口、额外依赖、网络或扩大读取范围。
- 使用真实独立 Python 与 macOS 沙箱运行：结果可写；读取/修改测试私有文件、连接正在监听的本地端口、执行子进程均返回权限拒绝。
- 缺失运行资源、快照改动、不同版本指纹被拒绝；取消、输出超限和符号链接结果不报告成功。
- Electron 桌面无 CLI 模式下导入 Python 技能、原生确认、执行及结果显示通过。截图 desktop-python.png。

该范围不表示任意 Python Skill 均兼容。未完成最低 macOS、干净机器、真实平台或公开分发公证验收。CPython 自带 LICENSE.txt 及现有运行依赖文件随包保留；完整二进制依赖许可汇总继续归任务 8.5。

0.1.11 DMG 验收通过：应用签名与镜像检查通过；从镜像提取的临时测试副本在无系统 CLI 环境中完成 Python 导入、授权和结果输出，以及原有模拟产品工作流。1913 个运行文件前后哈希一致，含独立 Python。此次使用标准库示例，不是原第三方联网脚本的兼容验收。
