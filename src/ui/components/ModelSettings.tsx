import { useEffect, useState } from "react";
import type { ModelProvider, CapabilityReport } from "../../contracts/models";
import { desktop, errorText } from "../bridge";
export function ModelSettings({ projectId }: { projectId: string }) {
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(
    null,
  );
  const [provider, setProvider] = useState<ModelProvider>("openai-compatible"),
    [endpoint, setEndpoint] = useState("https://api.openai.com/v1"),
    [model, setModel] = useState(""),
    [token, setToken] = useState(""),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void desktop()
      .models.capabilities(projectId)
      .then((v) => {
        if (active) setCapabilities(v);
      })
      .catch((e) => setError(errorText(e)));
    desktop()
      .models.profile(projectId)
      .then((value) => {
        if (value && active) {
          setProvider(value.provider);
          setEndpoint(value.endpoint);
          setModel(value.model);
          setSaved(value.hasCredential);
        }
        if (active) setLoaded(true);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <section className="model-settings">
      <h3>项目模型</h3>
      <p className="muted">凭证保存到 macOS 钥匙串，项目文件仅保存引用。</p>
      <form
        onChange={() => {
          setDirty(true);
          setError("");
          setNotice("");
          setCapabilities(null);
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await desktop().models.save(projectId, {
              provider,
              endpoint,
              model,
              ...(token ? { token } : {}),
            });
            setToken("");
            setDirty(false);
            setSaved(true);
            setNotice("模型配置已保存，可以测试连接或开始对话。");
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-field">
          <label htmlFor="model-provider">供应商</label>
          <select
            disabled={busy || !loaded}
            id="model-provider"
            value={provider}
            onChange={(e) => {
              const value = e.target.value as ModelProvider;
              setProvider(value);
              setEndpoint(
                value === "anthropic"
                  ? "https://api.anthropic.com/v1"
                  : "https://api.openai.com/v1",
              );
            }}
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="model-endpoint">Base URL</label>
          <input
            disabled={busy || !loaded}
            id="model-endpoint"
            required
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="model-id">模型名称</label>
          <input
            disabled={busy || !loaded}
            id="model-id"
            required
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="填写供应商提供的模型 ID"
          />
        </div>
        <div className="form-field">
          <label htmlFor="model-token">API token</label>
          <input
            disabled={busy || !loaded}
            id="model-token"
            type="password"
            autoComplete="off"
            required={!saved}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              saved ? "已保存到钥匙串；留空保留原凭证" : "填写 API token"
            }
          />
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            disabled={busy || !saved || dirty || !loaded}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await desktop().models.test(projectId);
                setNotice("连接成功：已收到模型响应。");
              } catch (error) {
                setError(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            测试已保存配置
          </button>
          <button className="primary" disabled={busy || !loaded}>
            {busy ? "处理中…" : "保存模型配置"}
          </button>
        </div>
      </form>
      {dirty && (
        <p role="status" className="muted">
          配置已修改，请先保存，再测试连接或检测模型能力。
        </p>
      )}
      <div className="notice">
        <strong>模型能力</strong>
        <p className="muted">
          检测会发起文本、测试图片和无副作用工具请求。Agent
          当前使用文本决策模式，不依赖原生工具调用。
        </p>
        <button
          disabled={busy || !saved || dirty || !loaded}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setCapabilities(await desktop().models.probe(projectId));
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          检测已保存模型的能力
        </button>
        {capabilities && (
          <>
            <p>
              文本：
              {
                {
                  supported: "已支持",
                  unsupported: "不支持",
                  unknown: "待检测",
                }[capabilities.text]
              }{" "}
              · 图像：
              {
                {
                  supported: "接口已接受",
                  unsupported: "不支持",
                  unknown: "待确认",
                }[capabilities.image]
              }{" "}
              · 原生工具：
              {
                {
                  supported: "已支持",
                  unsupported: "不支持",
                  unknown: "待确认",
                }[capabilities.tools]
              }
            </p>
            {capabilities.notes.map((note, i) => (
              <p className="muted" key={i}>
                {note}
              </p>
            ))}
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
