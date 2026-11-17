import { useEffect, useState } from "react";
import type { ModelProvider } from "../../contracts/models";
import { desktop, errorText } from "../bridge";
export function ModelSettings({ projectId }: { projectId: string }) {
  const [provider, setProvider] = useState<ModelProvider>("openai-compatible"),
    [endpoint, setEndpoint] = useState("https://api.openai.com/v1"),
    [model, setModel] = useState(""),
    [token, setToken] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    desktop()
      .models.profile(projectId)
      .then((value) => {
        if (value && active) {
          setProvider(value.provider);
          setEndpoint(value.endpoint);
          setModel(value.model);
          setSaved(value.hasCredential);
        }
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
            disabled={busy || !saved}
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
          <button className="primary" disabled={busy}>
            {busy ? "处理中…" : "保存模型配置"}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
