import { useEffect, useState } from "react";
import type {
  RemoteDocumentSnapshot,
  DocumentChangeReview,
  DocumentMergePlan,
} from "../../contracts/document-review";
import { desktop, errorText } from "../bridge";
export function DocumentChanges({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [snapshot, setSnapshot] = useState<RemoteDocumentSnapshot | null>(null),
    [selected, setSelected] = useState(""),
    [after, setAfter] = useState(""),
    [review, setReview] = useState<DocumentChangeReview | null>(null),
    [plan, setPlan] = useState<DocumentMergePlan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    desktop()
      .documentReviews.saved(projectId, runId)
      .then((saved) => {
        if (!active) return;
        setSnapshot(saved.snapshot);
        setReview(saved.review);
        setSelected(saved.review?.sectionId ?? "");
        setAfter(saved.review?.after ?? "");
        setPlan(null);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, runId]);
  const section = snapshot?.sections.find((s) => s.id === selected);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>线上文档差异评审</h3>
      <p className="muted">
        读取飞书最新内容，选择文字章节后编辑。截图、附件、链接和复杂格式保留原样。本阶段只审阅，不写回线上。
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const value = await desktop().documentReviews.fetch(
              projectId,
              runId,
            );
            setSnapshot(value);
            setSelected("");
            setReview(null);
            setPlan(null);
            setAfter("");
          })
        }
      >
        读取线上最新文档
      </button>
      {snapshot && (
        <>
          <p>
            已读取：{snapshot.title} ·{" "}
            {new Date(snapshot.fetchedAt).toLocaleString()}
          </p>
          <label>
            章节或内容范围
            <select
              aria-label="线上文档章节"
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setAfter(
                  snapshot.sections.find((s) => s.id === e.target.value)
                    ?.text ?? "",
                );
                setReview(null);
                setPlan(null);
              }}
            >
              <option value="">请选择</option>
              {snapshot.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.editable ? "" : "（只读保留）"}
                </option>
              ))}
            </select>
          </label>
          {section && (
            <>
              <details open>
                <summary>线上原文</summary>
                <pre className="document-text">{section.text}</pre>
              </details>
              {section.editable && (
                <>
                  <label>
                    修改后内容
                    <textarea
                      aria-label="章节修改内容"
                      rows={8}
                      maxLength={30000}
                      disabled={busy}
                      value={after}
                      onChange={(e) => {
                        setAfter(e.target.value);
                        setReview(null);
                        setPlan(null);
                      }}
                    />
                  </label>
                  <button
                    disabled={busy || after === section.text}
                    onClick={() =>
                      void action(async () => {
                        setReview(
                          await desktop().documentReviews.prepare(
                            projectId,
                            snapshot.id,
                            section.id,
                            after,
                          ),
                        );
                      })
                    }
                  >
                    生成章节差异
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
      {review && (
        <>
          <h4>差异：{review.title}</h4>
          <pre className="document-text">
            {review.diff.map((line, i) => (
              <span
                key={i}
                style={{
                  display: "block",
                  background:
                    line.kind === "added"
                      ? "#e5f0e4"
                      : line.kind === "removed"
                        ? "#f6e4df"
                        : undefined,
                }}
              >
                {line.kind === "added"
                  ? "+ "
                  : line.kind === "removed"
                    ? "− "
                    : "  "}
                {line.text || " "}
              </span>
            ))}
          </pre>
          <button
            disabled={busy || review.state !== "pending"}
            onClick={() =>
              void action(async () => {
                setReview(
                  await desktop().documentReviews.approve(
                    projectId,
                    review.id,
                    review.digest,
                  ),
                );
              })
            }
          >
            重新核对线上并批准差异
          </button>
          {review.state === "approved" && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setPlan(null);
                  try {
                    setPlan(
                      await desktop().documentReviews.preflight(
                        projectId,
                        review.id,
                        review.digest,
                      ),
                    );
                  } catch (e) {
                    if (errorText(e).includes("批准失效"))
                      setReview({
                        ...review,
                        state: "conflict",
                        approvedAt: undefined,
                      });
                    throw e;
                  }
                })
              }
            >
              检查合并条件
            </button>
          )}
          {plan && (
            <p role="status">
              预检通过：涉及 {plan.edits.length} 个文字块，读取版本{" "}
              {plan.revision}。原文写入尚未开放；此结果不代表锁定远端版本。
            </p>
          )}
          <p role="status">
            {review.state === "approved"
              ? "差异已批准，尚未合并；实际合并前仍需再次核对。"
              : review.state === "conflict"
                ? "线上内容已变化，批准失效。请重新读取并评审。"
                : "待审阅：绿色为新增，红色为删除。"}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
