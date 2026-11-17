import { useEffect, useState } from "react";
import type { DocumentDraft, PrototypeState } from "../../contracts/documents";
import type { PrototypeVersion } from "../../contracts/workbench";
import { desktop, errorText } from "../bridge";
export function Documents({ projectId }: { projectId: string }) {
  const [versions, setVersions] = useState<PrototypeVersion[]>([]),
    [states, setStates] = useState<PrototypeState[]>([]),
    [drafts, setDrafts] = useState<DocumentDraft[]>([]),
    [versionId, setVersionId] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [goal, setGoal] = useState(""),
    [current, setCurrent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      desktop().workbench.versions(projectId),
      desktop().documents.states(projectId),
      desktop().documents.list(projectId),
    ])
      .then(([v, s, d]) => {
        if (!active) return;
        setVersions(v.filter((v) => v.approved));
        setVersionId(v.find((v) => v.approved)?.id ?? "");
        setStates(s);
        setDrafts(d);
        setCurrent(d[0]?.id ?? "");
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
      void desktop().documents.cancel(projectId);
    };
  }, [projectId]);
  const [images, setImages] = useState<{ label: string; dataUrl: string }[]>(
    [],
  );
  useEffect(() => {
    setImages([]);
    if (!current) return;
    let active = true;
    void desktop()
      .documents.images(projectId, current)
      .then((v) => {
        if (active) setImages(v);
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [projectId, current]);
  const draft = drafts.find((d) => d.id === current);
  return (
    <article className="paper">
      <h2>从批准原型撰写 PRD</h2>
      <p>
        先在原型中体验页面，通过版本后保存列表、弹窗等状态截图，再选择对应截图生成文档。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label>
        批准版本
        <select
          aria-label="文档原型版本"
          value={versionId}
          disabled={busy}
          onChange={(e) => {
            setVersionId(e.target.value);
            setChosen([]);
          }}
        >
          {!versions.length && <option value="">暂无批准原型</option>}
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {new Date(v.createdAt).toLocaleString()} · 已通过
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={busy}>
        <legend>文档包含的页面状态</legend>
        {states
          .filter((s) => s.versionId === versionId)
          .map((s) => (
            <label className="state-choice" key={s.id}>
              <input
                type="checkbox"
                checked={chosen.includes(s.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, s.id]
                      : chosen.filter((id) => id !== s.id),
                  )
                }
              />
              {s.label}
            </label>
          ))}
        {!states.some((s) => s.versionId === versionId) && (
          <p className="muted">此版本尚无截图，请返回原型保存页面状态。</p>
        )}
      </fieldset>
      <textarea
        aria-label="文档要求"
        placeholder="补充本次需求的目标、范围或需要强调的交互…"
        rows={4}
        value={goal}
        disabled={busy}
        onChange={(e) => setGoal(e.target.value)}
      />
      <button
        className="primary"
        disabled={!versionId || !chosen.length || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const d = await desktop().documents.generate(
              projectId,
              versionId,
              chosen,
              goal,
            );
            setDrafts([d, ...drafts]);
            setCurrent(d.id);
            setNotice("草稿已保存在工作空间，请审阅正文及截图。");
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在撰写…" : "生成 PRD 草稿"}
      </button>
      {busy && (
        <button onClick={() => void desktop().documents.cancel(projectId)}>
          取消生成
        </button>
      )}
      <hr />
      <h2>本地草稿</h2>
      <select
        aria-label="文档草稿"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      >
        {!drafts.length && <option value="">尚无草稿</option>}
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            {new Date(d.createdAt).toLocaleString()}
          </option>
        ))}
      </select>
      {draft && (
        <>
          <p className="muted">
            绑定批准版本 {draft.versionId.slice(0, 8)} · {draft.stateIds.length}{" "}
            张状态截图
          </p>
          <pre className="document-text">{draft.markdown}</pre>
          {images.map((image, i) => (
            <figure key={i}>
              <figcaption>{image.label}</figcaption>
              <img
                className="document-image"
                src={image.dataUrl}
                alt={image.label}
              />
            </figure>
          ))}
          <button
            onClick={async () => {
              try {
                if (await desktop().documents.export(projectId, draft.id))
                  setNotice("已导出 HTML 草稿和对应截图。");
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            导出含截图的 HTML
          </button>
        </>
      )}
    </article>
  );
}
