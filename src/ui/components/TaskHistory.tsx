import { AgentTasks } from "./AgentTasks";
import { useEffect, useState } from "react";
import type { PrototypeTask } from "../../contracts/workbench";
import { desktop, errorText } from "../bridge";
const labels: Record<string, string> = {
  running: "生成中",
  succeeded: "已保存候选",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "退出时中断",
};
export function TaskHistory({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<PrototypeTask[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    desktop()
      .workbench.tasks(projectId)
      .then(setTasks)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void refresh();
    return desktop().workbench.onProgress((e) => {
      if (e.projectId === projectId) void refresh();
    });
  }, [projectId]);
  return (
    <>
      <p className="muted">
        工作流用于运行多步骤 Agent
        任务、确认待执行操作，以及查看和恢复中断记录。交接文档请到「工作台 →
        交接资料」导入。
      </p>
      <AgentTasks projectId={projectId} />
      <article className="paper">
        <h2>原型生成记录</h2>
        <p className="muted">
          重试会使用原页面依据、基线和修改要求，重新调用模型并保存新候选。不会覆盖旧版，也不执行平台发布。
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!tasks.length && <p>还没有原型生成任务。</p>}
        {tasks.map((t) => (
          <section key={t.id} className="notice">
            <strong>{labels[t.state] ?? t.state}</strong> ·{" "}
            {new Date(t.createdAt).toLocaleString()}
            {t.outputId && <p>候选版本：{t.outputId}</p>}
            {t.recoverable && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await desktop().workbench.retry(projectId, t.id);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                    void refresh();
                  }
                }}
              >
                从原依据重试
              </button>
            )}
          </section>
        ))}
      </article>
    </>
  );
}
