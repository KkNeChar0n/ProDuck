import type { ElementSelection } from "../../contracts/workbench";
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
  const [targets, setTargets] = useState<
    { element: ElementSelection; prompt: string }[]
  >([]);
  useEffect(() => {
    setTargets([]);
    setPrompt("");
  }, [prototypeContext?.versionId]);
  useEffect(() => {
    if (!prototypeContext?.picks.length) return;
    setTargets((items) => {
      const next = [...items];
      for (const element of prototypeContext.picks) {
        if (
          !next.some((item) => item.element.id === element.id) &&
          next.length < 12
        )
          next.push({ element, prompt: "" });
      }
      return next;
    });
  }, [prototypeContext?.picks]);
  const canSend =
    !!project &&
    (targets.length
      ? targets.every((item) => item.prompt.trim())
      : !!prompt.trim());
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
    if (!project || !canSend || running) return;
    setError("");
    const requestId = crypto.randomUUID(),
      text = prompt;
    const submittedTargets = targets;
    setMessages((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: [
          text,
          ...submittedTargets.map(
            (item, i) => `${i + 1}. #${item.element.id}：${item.prompt}`,
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      },
      { id: requestId, role: "assistant", text: "" },
    ]);
    setRunning(true);
    try {
      if (prototypeContext) {
        const version = await desktop().workbench.generate(
          project.id,
          prototypeContext.captureId,
          text,
          prototypeContext.versionId,
          undefined,
          submittedTargets.length
            ? {
                baselineId: prototypeContext.versionId,
                contentHash: prototypeContext.contentHash,
                items: submittedTargets.map((item) => ({
                  elementId: item.element.id,
                  prompt: item.prompt,
                })),
              }
            : undefined,
        );
        setMessages((items) =>
          items.map((m) =>
            m.id === requestId
              ? { ...m, text: "修改已保存为新候选版本，请在原型中体验后确认。" }
              : m,
          ),
        );
      } else await desktop().models.stream(project.id, requestId, text);
      setPrompt("");
      setTargets([]);
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
        <span className="current">理解产品</span>
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
              在原型页发送要求会生成新候选；其他页面问答会参考已审核的项目理解，暂不保存对话历史。
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
        {prototypeContext && (
          <section className="element-editor">
            <div className="element-editor-heading">
              <strong>调整原型</strong>
              <button
                type="button"
                disabled={running}
                aria-label="元素拾取器"
                aria-pressed={prototypeContext.picking}
                onClick={() =>
                  void prototypeContext
                    .togglePicker()
                    .catch((e) => setError(errorText(e)))
                }
              >
                {prototypeContext.picking ? "结束拾取" : "⌖ 拾取元素"}
              </button>
            </div>
            <small>
              点击原型后逐条填写，最多 12 处，一起提交。切换原型将清空选择。
            </small>
            <div className="element-prompt-list">
              {targets.map((item, index) => (
                <div className="element-prompt" key={item.element.id}>
                  <div>
                    <strong>
                      {index + 1}.{" "}
                      {item.element.text.slice(0, 45) || item.element.tag}
                    </strong>
                    <button
                      type="button"
                      disabled={running}
                      aria-label={`移除元素 ${index + 1}`}
                      onClick={() =>
                        setTargets((items) =>
                          items.filter((x) => x.element.id !== item.element.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                  <small title={item.element.id}>
                    {item.element.tag} · #{item.element.id}
                  </small>
                  <textarea
                    aria-label={`元素 ${index + 1} 修改要求`}
                    placeholder="仅针对这个元素的修改要求…"
                    rows={2}
                    maxLength={2000}
                    disabled={running}
                    value={item.prompt}
                    onChange={(e) =>
                      setTargets((items) =>
                        items.map((x) =>
                          x.element.id === item.element.id
                            ? { ...x, prompt: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            {!!targets.length && (
              <small>
                已选 {targets.length}/12 处 · 每处都填写后可统一提交
              </small>
            )}
          </section>
        )}
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
                ? targets.length
                  ? "整体补充要求（可选）…"
                  : "描述你希望如何调整当前页面…"
                : "描述你的产品问题…"
            }
            rows={targets.length ? 2 : 4}
            maxLength={3000}
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
                className={targets.length ? "primary" : "send"}
                aria-label="发送修改要求"
                disabled={!canSend}
              >
                {targets.length ? `提交 ${targets.length} 处` : "↑"}
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
