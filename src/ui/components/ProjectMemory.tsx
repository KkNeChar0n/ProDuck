import { useEffect, useState } from "react";
import { desktop, errorText } from "../bridge";
import type { PageMemory } from "../../contracts/workbench";
export function ProjectMemory({ projectId }: { projectId: string }) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [entries, setEntries] = useState<PageMemory[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      desktop().projects.memory(projectId),
      desktop().projects.pageMemory(projectId, ""),
    ])
      .then(([root, pages]) => {
        if (active) {
          setText(root);
          setEntries(pages);
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
    <article className="paper">
      <h2>记忆.md</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <pre className="memory-content">{text || "正在读取…"}</pre>
      <form
        className="url-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            setEntries(await desktop().projects.pageMemory(projectId, query));
          } catch (error) {
            setError(errorText(error));
          }
        }}
      >
        <input
          aria-label="检索项目记忆"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按页面名称、地址或内容检索"
        />
        <button>检索</button>
      </form>
      {entries.map((entry) => (
        <details key={entry.id} className="memory-entry">
          <summary>
            {entry.title}{" "}
            <span className="pill">
              {entry.status === "confirmed" ? "用户确认" : "已观察"}
            </span>
          </summary>
          <p className="muted">
            {entry.url}
            <br />
            {new Date(entry.capturedAt).toLocaleString()}
          </p>
          <pre className="memory-content">{entry.text}</pre>
          {entry.conflictsWith.map((old) => (
            <div className="notice" key={old.id}>
              <strong>与已确认记录存在差异</strong>
              <p>{new Date(old.capturedAt).toLocaleString()}</p>
              <pre className="memory-content">{old.text}</pre>
              <p>
                旧记录已保留；此处仅显示内容差异，不自动判断业务规则发生变化。
              </p>
            </div>
          ))}
          {entry.status !== "confirmed" && (
            <button
              onClick={() =>
                void desktop()
                  .projects.confirmMemory(projectId, entry.id)
                  .then(setEntries)
                  .catch((e) => setError(errorText(e)))
              }
            >
              确认此采集内容
            </button>
          )}
          <p className="notice">
            页面之外的业务规则、权限和未观察到的状态仍待验证。
          </p>
          <button
            onClick={() =>
              void desktop()
                .workbench.revealCapture(projectId, entry.id)
                .catch((e) => setError(errorText(e)))
            }
          >
            查看采集依据
          </button>
        </details>
      ))}
      {!entries.length && (
        <p className="muted">
          没有匹配的页面记忆。可先在浏览器中采集页面状态。
        </p>
      )}
    </article>
  );
}
