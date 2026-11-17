import { useEffect, useState } from "react";
import type { PublicationReview } from "../../contracts/publication";
import { desktop, errorText } from "../bridge";
export function PublicationReviewPanel({
  projectId,
  draftId,
}: {
  projectId: string;
  draftId: string;
}) {
  const [review, setReview] = useState<PublicationReview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
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
        固定当前正文、状态截图和批准原型，并读取飞书迭代父节点。当前仅保存本地审阅包，尚不上传或创建飞书文档。
      </p>
      <button
        disabled={busy}
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
            {review.status === "approved" ? "已确认材料，未发布" : "待审阅"}
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
            确认仅针对此份材料。未来发布前仍需核对内容和远端状态，并单独确认执行。
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
