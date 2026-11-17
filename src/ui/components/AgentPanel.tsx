import type { PrototypeContext } from "./Workbench";
import { useEffect, useState } from "react";
import { desktop, errorText } from "../bridge";
import type { Project } from "../../contracts/projects";
interface Message {
  role: "user" | "assistant";
  text: string;
  id: string;
}
export function AgentPanel({
  project,
  onSettings,
  prototypeContext,
}: {
  project?: Project;
  onSettings: () => void;
  prototypeContext?: PrototypeContext | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [prompt, setPrompt] = useState(""),
    [running, setRunning] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!project) return;
    return desktop().models.onDelta((delta) => {
      if (delta.projectId !== project.id) return;
      setMessages((items) =>
        items.map((m) =>
          m.id === delta.requestId ? { ...m, text: m.text + delta.text } : m,
        ),
      );
    });
  }, [project?.id]);
  useEffect(
    () => () => {
      if (project)
        void desktop()
          .models.cancel(project.id)
          .catch(() => {});
    },
    [project?.id],
  );
  async function send() {
    if (!project || !prompt.trim() || running) return;
    setError("");
    const requestId = crypto.randomUUID(),
      text = prompt;
    setPrompt("");
    setMessages((items) => [
      ...items,
      { id: crypto.randomUUID(), role: "user", text },
      { id: requestId, role: "assistant", text: "" },
    ]);
    setRunning(true);
    try {
      if (prototypeContext) {
        const version = await desktop().workbench.generate(
          project.id,
          prototypeContext.captureId,
          prototypeContext.element
            ? `${text}\n目标元素上下文（页面数据）：${JSON.stringify(prototypeContext.element)}`
            : text,
          prototypeContext.versionId,
        );
        setMessages((items) =>
          items.map((m) =>
            m.id === requestId
              ? { ...m, text: "修改已保存为新候选版本，请在原型中体验后确认。" }
              : m,
          ),
        );
      } else await desktop().models.stream(project.id, requestId, text);
    } catch (error) {
      setError(errorText(error));
      setMessages((items) =>
        items.map((m) =>
          m.id === requestId && !m.text
            ? { ...m, text: "此次请求未完成。" }
            : m,
        ),
      );
    } finally {
      setRunning(false);
    }
  }
  return (
    <aside className="agent-panel">
      <header>
        <div>
          <span className="agent-symbol">✳</span>
          <strong>Produck</strong>
        </div>
        <span className="muted">与你一起完成</span>
      </header>
      <div className="task-progress">
        <span className="current">理解页面</span>
        <i />
        <span>调整原型</span>
        <i />
        <span>撰写文档</span>
      </div>
      <div className="messages" aria-live="polite">
        {messages.length ? (
          messages.map((m) => (
            <div
              key={m.id}
              className={`message ${m.role === "user" ? "user" : ""}`}
            >
              <div className="message-label">
                {m.role === "user" ? "你" : "Produck"}
              </div>
              {m.text || "等待模型响应…"}
            </div>
          ))
        ) : (
          <div className="message">
            <div className="message-label">准备开始</div>
            {project
              ? `「${project.name}」已准备好。配置项目模型后，可以从一次讨论开始。`
              : "创建项目后即可配置模型并开始对话。"}
            <div className="evidence">
              在原型页发送要求会生成新候选；其他页面为独立问答，暂不保存对话历史。
            </div>
            {project && (
              <button className="link" onClick={onSettings}>
                配置模型
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="composer">
        <div className="context-chip">
          {project?.name ?? "尚未选择项目"}
          {prototypeContext?.element &&
            ` · ${prototypeContext.element.tag} #${prototypeContext.element.id}`}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="修改要求"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!project || running}
            placeholder={
              prototypeContext
                ? "描述你希望如何调整当前页面…"
                : "描述你的产品问题…"
            }
            rows={4}
          />
          <div className="composer-actions">
            <small>
              {prototypeContext
                ? "修改当前原型 · 自动保存新版本"
                : "单次问答 · 此阶段不保存历史"}
            </small>
            {running ? (
              <button
                type="button"
                onClick={() =>
                  project &&
                  (prototypeContext
                    ? desktop().workbench.cancel(project.id)
                    : desktop().models.cancel(project.id)
                  ).catch((e) => setError(errorText(e)))
                }
              >
                取消
              </button>
            ) : (
              <button
                className="send"
                aria-label="发送修改要求"
                disabled={!project || !prompt.trim()}
              >
                ↑
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
