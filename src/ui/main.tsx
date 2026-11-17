import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopBridge, DesktopInfo } from "../contracts/desktop";
import "./shell.css";
declare global {
  interface Window {
    produck?: DesktopBridge;
  }
}
function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (window.produck)
      window.produck
        .getInfo()
        .then(setInfo)
        .catch(() => setError("无法读取桌面信息，请重启应用"));
  }, []);
  return (
    <main>
      <span className="mark">
        produck<span>●</span>
      </span>
      <h1>你的产品工作空间</h1>
      <p>桌面基础工程已就绪。工作台界面正在原型中验收。</p>
      <dl>
        <dt>当前阶段</dt>
        <dd>桌面基础与浏览器技术验证</dd>
        <dt>版本</dt>
        <dd>{info?.version ?? "浏览器预览"}</dd>
      </dl>
      {error && <p role="alert">{error}</p>}
      <p className="note">
        此窗口用于验证桌面启动与隔离通信，尚未连接模型或外部平台。
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
