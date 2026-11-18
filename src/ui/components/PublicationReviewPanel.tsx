import { YunxiaoSyncPanel } from "./YunxiaoSyncPanel";
import { DocumentChanges } from "./DocumentChanges";
import { useEffect, useState } from "react";
import type {
  PublicationReview,
  PublicationRun,
} from "../../contracts/publication";
import { desktop, errorText } from "../bridge";
export function PublicationReviewPanel({
  projectId,
  draftId,
}: {
  projectId: string;
  draftId: string;
}) {
  const [review, setReview] = useState<PublicationReview | null>(null),
    [run, setRun] = useState<PublicationRun | null>(null),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    desktop()
      .publication.runs(projectId)
      .then((runs) => {
        if (active) {
          const current = runs.find((r) => r.draftId === draftId);
          setRun(current ?? null);
          setTitle(current?.title ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    desktop()
      .publication.list(projectId)
      .then((items) => {
        if (active) setReview(items.find((r) => r.draftId === draftId) ?? null);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId, draftId]);
  async function perform(action: () => Promise<PublicationReview>) {
    setBusy(true);
    setError("");
    try {
      setReview(await action());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>发布材料审阅</h3>
      <p className="muted">
        固定正文、截图和批准原型，核对飞书迭代父节点。确认材料后可发布；发布前会再次确认目标与内容。
      </p>
      <button
        disabled={busy || !!run}
        onClick={() =>
          void perform(() => desktop().publication.prepare(projectId, draftId))
        }
      >
        {busy ? "正在核对…" : review ? "重新准备审阅包" : "准备发布审阅包"}
      </button>
      {review && (
        <>
          <p>
            目标父节点：{review.parent.title}
            <br />
            <span className="path">{review.parent.url}</span>
          </p>
          <ul>
            {review.files.map((file) => (
              <li key={file.path}>
                {file.label} · {Math.ceil(file.bytes / 1024)} KB
              </li>
            ))}
          </ul>
          <p className="muted">
            材料指纹：{review.digest.slice(0, 16)} ·{" "}
            {run?.state === "published"
              ? "已发布并读回验证"
              : review.status === "approved"
                ? "已确认材料，未发布"
                : "待审阅"}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              desktop()
                .publication.reveal(projectId, review.id)
                .catch((e) => setError(errorText(e)))
            }
          >
            打开审阅包
          </button>{" "}
          <button
            disabled={busy || review.status === "approved"}
            onClick={() =>
              void perform(() =>
                desktop().publication.approve(
                  projectId,
                  review.id,
                  review.digest,
                ),
              )
            }
          >
            确认材料与父节点
          </button>
          <p className="muted">
            正文以 Markdown
            原文段落写入，截图为独立图片。首版不自动覆盖不同版本的迭代共用原型。
          </p>
          {review.status === "approved" && (
            <>
              <label>
                需求文档标题
                <input
                  aria-label="发布文档标题"
                  value={title}
                  disabled={busy || !!run}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !title.trim() || run?.state === "published"}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await desktop().publication.publish(
                      projectId,
                      review.id,
                      review.digest,
                      title,
                    );
                    if (result) setRun(result);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "正在核对与发布…"
                  : run?.state === "published"
                    ? "已发布"
                    : run
                      ? "核对并继续发布"
                      : "发布到飞书"}
              </button>
            </>
          )}
          {run && (
            <div role="status">
              <p>
                {run.message?.replace("云效尚未同步", "云效同步另有独立收据") ??
                  "发布处理中"}
              </p>
              {run.documentUrl && <p className="path">{run.documentUrl}</p>}
              <p>
                已确认步骤 {run.steps.filter((s) => s.state === "done").length}/
                {run.steps.length} · 云效状态见下方独立收据
              </p>
            </div>
          )}
        </>
      )}
      {run?.state === "published" && (
        <>
          <YunxiaoSyncPanel
            key={`sync-${run.id}`}
            projectId={projectId}
            publicationId={run.id}
          />
          <DocumentChanges key={run.id} projectId={projectId} runId={run.id} />
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
