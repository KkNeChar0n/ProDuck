import { useEffect, useState } from "react";
import type { DiscoveryRun } from "../../contracts/discovery";
import { desktop, errorText } from "../bridge";
import { latestDescendant } from "../../prototypes/lineage";
export function PagePaintProgress({
  projectId,
  onOpen,
  onStatus,
}: {
  projectId: string;
  onOpen: (id: string) => void;
  onStatus?: (text: string) => void;
}) {
  const [run, setRun] = useState<DiscoveryRun | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true,
      loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        const s = await desktop().discovery.state(projectId);
        if (alive) setRun(s.run);
      } catch (e) {
        if (alive) setError(errorText(e));
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);
  useEffect(() => {
    const tasks = run?.pageTasks ?? [],
      failed = tasks.filter((p) => p.state === "failed").length;
    onStatus?.(
      tasks.length
        ? `已完成 ${tasks.filter((p) => p.state === "done").length}/${tasks.length} 页${failed ? ` · ${failed} 页失败，展开可重试` : ""}`
        : "",
    );
  }, [run, onStatus]);
  if (!run?.pageTasks?.length) return null;
  const tasks = run.pageTasks,
    done = tasks.filter((p) => p.state === "done").length;
  return (
    <section className="page-paint-progress" aria-label="逐页绘制任务">
      <strong>
        页面原型 · 已完成 {done}/{tasks.length} 页
      </strong>
      <p className="muted">
        每页独立绘制；复杂页面自动拆为区域。可先查看已完成页面，失败只重试未完成区域。
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="page-paint-list">
        {tasks.map((task) => (
          <div key={task.id} className="page-paint-item">
            <span>
              {task.module} · {task.title}
            </span>
            <small>
              {
                (
                  {
                    pending: "等待绘制",
                    running: "正在绘制",
                    done: "已完成",
                    failed: "绘制失败",
                  } as const
                )[task.state]
              }{" "}
              · 区域 {task.parts.filter((p) => p.state === "done").length}/
              {task.parts.length}
            </small>
            {task.error && <p role="alert">{task.error}</p>}
            {task.versionId && (
              <button
                onClick={() =>
                  void desktop()
                    .workbench.versions(projectId)
                    .then((v) => onOpen(latestDescendant(v, task.versionId!)))
                    .catch((e) => setError(errorText(e)))
                }
              >
                查看页面原型
              </button>
            )}
            {task.versionId && (
              <button
                disabled={
                  busy || run.state === "running" || run.phase === "generating"
                }
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void desktop()
                    .discovery.generateCandidate(
                      projectId,
                      run.id,
                      task.id,
                      true,
                    )
                    .then((result) => {
                      setRun(result);
                      if (result.prototypeVersionId)
                        onOpen(result.prototypeVersionId);
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                重新绘制此页
              </button>
            )}
            {task.state === "failed" && (
              <button
                disabled={
                  busy || run.state === "running" || run.phase === "generating"
                }
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void desktop()
                    .discovery.generateCandidate(projectId, run.id, task.id)
                    .then(setRun)
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                重试此页
              </button>
            )}
            {task.parts.length > 1 && (
              <details>
                <summary>区域任务</summary>
                {task.parts.map((p, i) => (
                  <p key={p.id}>
                    区域 {i + 1} ·{" "}
                    {p.state === "done"
                      ? "已完成"
                      : p.state === "running"
                        ? "绘制中"
                        : p.state === "failed"
                          ? "失败"
                          : "等待"}
                    {p.error ? `：${p.error}` : ""}
                  </p>
                ))}
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
