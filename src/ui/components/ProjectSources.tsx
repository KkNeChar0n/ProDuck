import { useEffect, useState } from "react";
import type { SourceDocument } from "../../contracts/sources";
import { desktop, errorText } from "../bridge";
export function ProjectSources({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<SourceDocument[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    desktop()
      .projects.sources(projectId)
      .then((v) => {
        if (active) setSources(v);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  async function importDocument() {
    setBusy(true);
    setError("");
    try {
      const source = await desktop().projects.importSource(projectId);
      if (source) setSources((v) => [...v, source]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="paper">
      <h2>从交接资料开始</h2>
      <p>导入其他 Agent 的交接文档，或产品现有的说明资料。</p>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void importDocument()}
      >
        {busy ? "等待选择文件…" : "导入交接资料"}
      </button>
      <p className="muted">
        支持 UTF-8 的 Markdown、纯文本和 HTML，每份不超过 5
        MB。导入文件不会自动发送给模型。
      </p>
      {sources.map((s) => (
        <div className="info-row" key={s.id}>
          <div>
            {s.name}
            <small>
              {new Date(s.importedAt).toLocaleString()} ·{" "}
              {Math.ceil(s.bytes / 1024)} KB
            </small>
          </div>
          <span className="pill">已导入</span>
        </div>
      ))}
      {!sources.length && (
        <p className="muted">还没有资料。网页采集功能正在接入。</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
