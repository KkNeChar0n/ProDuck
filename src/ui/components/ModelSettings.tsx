import { useEffect, useState, useRef } from "react";
import type {
  ModelProvider,
  CapabilityReport,
  ReasoningEffort,
} from "../../contracts/models";
import { desktop, errorText } from "../bridge";
export function ModelSettings({ projectId }: { projectId: string }) {
  const [catalog, setCatalog] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [effort, setEffort] = useState<ReasoningEffort>("default");
  const generation = useRef(0);
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
    generation.current++;
    setCatalog([]);
    return () => {
      generation.current++;
    };
  }, [projectId, provider, endpoint, token]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setSaved(false);
    setDirty(false);
    setToken("");
    setModel("");
    setEffort("default");
    setCapabilities(null);
    setError("");
    setNotice("");
    setManual(false);
    setBusy(false);
    setProvider("openai-compatible");
    setEndpoint("https://api.openai.com/v1");
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
          setEffort(value.reasoningEffort ?? "default");
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
              reasoningEffort: effort,
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
              setEffort("default");
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
          {manual ? (
            <input
              disabled={busy || !loaded}
              id="model-id"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="填写供应商提供的模型 ID"
            />
          ) : (
            <select
              id="model-id"
              disabled={busy || !loaded}
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">请先读取模型列表</option>
              {model && !catalog.includes(model) && (
                <option value={model}>{model}（当前配置）</option>
              )}
              {catalog.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy || !loaded}
              onClick={async () => {
                const current = generation.current;
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const ids = await desktop().models.catalog(projectId, {
                    provider,
                    endpoint,
                    ...(token ? { token } : {}),
                  });
                  if (current !== generation.current) return;
                  setCatalog(ids);
                  setManual(false);
                  setNotice(
                    ids.length
                      ? `已读取 ${ids.length} 个模型，请选择后保存。`
                      : "服务未返回可用模型，可以手动填写模型 ID。",
                  );
                } catch (e) {
                  if (current === generation.current) setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              读取 / 刷新模型列表
            </button>
            <button
              type="button"
              disabled={busy || !loaded}
              onClick={() => setManual(!manual)}
            >
              {manual ? "使用下拉选择" : "手动填写模型 ID"}
            </button>
          </div>
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
        <div className="form-field">
          <label htmlFor="model-effort">推理强度</label>
          <select
            id="model-effort"
            disabled={busy || !loaded || provider === "anthropic"}
            value={effort}
            onChange={(e) => setEffort(e.target.value as ReasoningEffort)}
          >
            <option value="default">供应商默认（推荐）</option>
            <option value="none">关闭 · none</option>
            <option value="minimal">最低 · minimal</option>
            <option value="low">低 · low</option>
            <option value="medium">中 · medium</option>
            <option value="high">高 · high</option>
            <option value="xhigh">极高 · xhigh</option>
          </select>
          <p className="muted">
            {provider === "anthropic"
              ? "Anthropic 暂使用供应商默认推理设置。"
              : "模型列表不代表支持全部强度。档位取决于模型和代理，请保存后测试；强度提高可能增加耗时与费用。"}
          </p>
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
