# Electron 浏览器技术验证

日期：2026-11-17。环境：macOS 26.3、arm64、Electron 45.3.3。

运行：`npm run build && npm run test:browser-spike`。

使用临时 Electron profile 和 127.0.0.1 随机端口的模拟网站。未访问真实系统，未读取个人浏览器登录状态或使用真实凭证。

## 结果

- WebContentsView 支持登录表单提交，登录后可浏览客户页面；HttpOnly cookie 未暴露给页面脚本。
- DOM 读取、筛选输入、点击、必填校验、模拟新增均正常。
- 截图成功，生成 browser-fixture.png；采集内容保存 browser-fixture-capture.json。
- 销毁并重新创建同项目视图后，登录状态保留；另一项目的 session partition 保持未登录。
- 远程页面的 require 和 window.produck 均为 undefined。
- sandbox/contextIsolation 启用的桌面 preload 可返回应用信息；主进程校验发起 IPC 的 webContents 和主 frame。

`browser-spike-result.json` 记录执行结果。检查过程中发现截图早于窗口绘制会出现 UnknownVizError；等待两次 animation frame 后 capturePage 成功。开发环境可能注入 ELECTRON_RUN_AS_NODE，启动脚本只移除此标志，避免误以 Node 模式启动 Electron。

## 边界

登录验证使用模拟网站的标准表单路径，并以程序模拟用户填写及提交；真实网站 SSO、验证码和跨域登录还没有验证。验证了同进程视图重建后的 session 保留，没有验证完整进程重启后的登录保留。

这里证明浏览器基础机制可行，不代表网页能被 AI 自动高保真重建。任务 1.4 尚未完成。
