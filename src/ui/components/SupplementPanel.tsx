import { useEffect, useRef, useState } from "react";
import type { DiscoveryRun } from "../../contracts/discovery";
import { supplementNeeds } from "../../discovery/supplements";
import { desktop, errorText } from "../bridge";
export interface BrowserSupplement {
  runId: string;
  needId: string;
  module: string;
  description: string;
  url: string;
}
export function SupplementPanel({
  projectId,
  run,
  busy,
  onSubmit,
  onBrowse,
}: {
  projectId: string;
  run: DiscoveryRun;
  busy: boolean;
  onSubmit: () => Promise<unknown>;
  onBrowse: (target: BrowserSupplement) => void;
}) {
  const needs = supplementNeeds(run);
  const currentRun = useRef(run.id);
  currentRun.current = run.id;
  const [drafts, setDrafts] = useState<
    Record<string, { image: string; description: string }>
  >({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([id]) =>
            run.continuedFrom &&
            supplementNeeds(run).some((n) => n.id === id && !n.captureId),
        ),
      ),
    );
  }, [run.id]);
  const count = Object.keys(drafts).length;
  async function paste(id: string, event: React.ClipboardEvent) {
    const file = Array.from(event.clipboardData.items)
      .find((i) => i.kind === "file" && /^image\/(png|jpeg)$/.test(i.type))
      ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    setError("");
    if (file.size > 20 * 1024 * 1024) {
      setError("请粘贴不超过20MB的截图");
      return;
    }
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (currentRun.current !== run.id) return;
      setDrafts((old) => ({
        ...old,
        [id]: { image, description: old[id]?.description ?? "" },
      }));
    } catch {
      setError("无法读取剪贴板图片，请重新截图后粘贴");
    }
  }
  return (
    <section aria-label="待补充列表">
      <h3>待补充列表 · {needs.filter((n) => !n.captureId).length} 项</h3>
      <p>
        在对应项里点击后按 ⌘V
        粘贴截图，也可以去浏览器补采页面。填完后提交，更新「原型」中的候选版本；永久记忆仍须单独审核。
      </p>
      {!needs.length && <p>当前没有记录缺失项，可直接到原型页体验。</p>}
      {needs.map((need) => (
        <div key={need.id} className="supplement-item">
          <strong>
            {need.module} · {need.captureId ? "资料已提交" : "待补充"}
          </strong>
          <p>{need.description}</p>
          {!need.captureId && (
            <>
              <div
                role="textbox"
                aria-label={`${need.module}截图粘贴区`}
                tabIndex={busy || submitting ? -1 : 0}
                className="paste-zone"
                onPaste={(event) => {
                  if (!busy && !submitting) void paste(need.id, event);
                }}
              >
                {drafts[need.id]?.image ? (
                  <img
                    src={drafts[need.id].image}
                    alt={`${need.module}待提交截图`}
                  />
                ) : (
                  "点击这里，按 ⌘V 粘贴截图"
                )}
              </div>
              {drafts[need.id] && (
                <>
                  <input
                    aria-label={`${need.module}补充说明`}
                    placeholder="截图说明（可选）"
                    maxLength={1000}
                    value={drafts[need.id].description}
                    disabled={busy || submitting}
                    onChange={(e) =>
                      setDrafts((old) => ({
                        ...old,
                        [need.id]: {
                          ...old[need.id],
                          description: e.target.value,
                        },
                      }))
                    }
                  />
                  <button
                    disabled={submitting}
                    onClick={() =>
                      setDrafts((old) =>
                        Object.fromEntries(
                          Object.entries(old).filter(([id]) => id !== need.id),
                        ),
                      )
                    }
                  >
                    移除截图
                  </button>
                </>
              )}
              <button
                disabled={busy || submitting}
                onClick={() =>
                  onBrowse({
                    runId: run.id,
                    needId: need.id,
                    module: need.module,
                    description: need.description,
                    url: run.url,
                  })
                }
              >
                去浏览器补采此项
              </button>
            </>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={busy || submitting || !count || count > 6}
        onClick={async () => {
          setSubmitting(true);
          setError("");
          try {
            await desktop().discovery.submitSupplements(
              projectId,
              run.id,
              Object.entries(drafts).map(([needId, d]) => ({ needId, ...d })),
            );
            setDrafts({});
            await onSubmit();
          } catch (e) {
            setError(errorText(e));
            await onSubmit();
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "正在补充原型…" : `提交 ${count} 项并补充原型`}
      </button>
      <p className="muted">
        每批最多6张。图片仅在你粘贴时读取，提交前不会发送给模型。
      </p>
    </section>
  );
}
