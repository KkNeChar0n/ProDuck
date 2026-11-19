# 随包运行时与依赖验证

2026-11-18，Produck 0.1.10，macOS arm64。

任务 7.4 按已确定的原生适配清单完成。内置技能使用随 Electron 提供的 Node/Chromium、编译后的 Produck 服务及原生钥匙串程序，没有选入需额外 Python 运行时的第三方脚本。第三方脚本授权仍属 7.5，未实现。

打包程序生成 runtime-manifest.json，列出 209 个编译文件、运行依赖和项目许可证的 SHA-256，以及 Electron/parse5/entities/React 等实际版本。校验拒绝文件增加、缺失或内容变化。Electron/Chromium 与 React 的许可证继续随包携带，parse5/entities 许可证随各自包目录携带。

`npm run test:packaged` 的验证过程：

1. 只读挂载生成的 DMG，复制 Produck.app 到临时目录，验证原包代码签名并卸载镜像。
2. 验证临时应用的运行资源清单。
3. 仅对测试副本更换启动入口，加入模拟测试脚本并重新 ad-hoc 签名；正式 DMG 不包含测试入口。
4. 从包内 Electron 可执行文件启动，加载包内 dist、依赖和钥匙串程序；工作目录在源码之外。清除 NODE_PATH/NODE_OPTIONS，并在测试进程将 PATH 设为空目录，确认 Node/Python/Codex/Claude 命令不可用。
5. 完成项目、模型、网页采集、候选原型、批准版本截图、PRD 草稿、说明型技能、内置 Agent、模拟飞书发布/差异及云效同步闭环。
6. 再次验证同一批 209 个运行资源哈希未变，清理临时应用。使用合成凭证，结束时删除对应钥匙串记录。

结果：通过。机器可读记录见 packaged-runtime.json；新增清单校验测试覆盖修改、丢失和意外增加文件。

边界：测试副本更换了启动入口，不能视作未修改应用的首次安装验收；宿主仍为开发机。最低 macOS、干净机器、真实模型质量、真实租户和 Developer ID 公证仍未验证，任务 8.2/8.3 不因此完成。测试包仅 ad-hoc 签名。

## 2026-11-19：0.1.11 增加 Python

按用户选择加入固定版本独立 CPython 3.12.16，清单扩大为 1913 个运行文件。保留 Python 包内相对符号链接，避免链接回构建目录。DMG 提取副本完成 Python 技能的原生授权和输出测试，运行前后哈希一致；具体支持边界见 python-skills.md。
