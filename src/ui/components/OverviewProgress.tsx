import type { DiscoveryRun } from "../../contracts/discovery";
export function OverviewProgress({
  run,
  exportPage,
}: {
  run: DiscoveryRun;
  exportPage: (id: string) => void;
}) {
  const modules = run.modules ?? [];
  const collected = modules.filter(
    (m) =>
      m.representativeIds?.length || run.steps.some((s) => s.module === m.name),
  ).length;
  return (
    <section aria-label="探索进度总览">
      <h3>
        {run.state === "running"
          ? "正在了解产品与采集页面"
          : "产品理解与页面资料"}
      </h3>
      <p>
        已采集 {collected}/{modules.length} 个已识别模块的页面 · 本轮{" "}
        {run.captureIds.length - (run.roundStart ?? 0)}/
        {run.budget - (run.roundStart ?? 0)} 个页面状态
      </p>
      <p className="muted">
        用于还原原型和撰写文档，不检查全部功能分支。历史观察直接复用，无需完成旧验收清单。
      </p>
      {modules.map((m) => {
        const ids = m.representativeIds?.length
          ? m.representativeIds
          : run.steps
              .filter((s) => s.module === m.name)
              .slice(-1)
              .map((s) => s.captureId);
        return (
          <details
            key={m.name}
            className="discovery-module-progress"
            open={run.activeModule === m.name}
          >
            <summary>
              {m.name} · {ids.length ? "已有页面资料" : "待采集或补图"} ·{" "}
              {m.markdown ? "已有阶段理解" : "待整理"}
            </summary>
            <p>
              <b>主要职责：</b>
              {m.purpose || "参考以下已有理解，后续采集时补充职责摘要"}
            </p>
            {m.captureNotes?.map((note, i) => (
              <p key={i} className="muted">
                需补充：{note}
              </p>
            ))}
            {ids.map((id, i) => (
              <button key={id} onClick={() => exportPage(id)}>
                导出页面 {i + 1}（HTML / 截图）
              </button>
            ))}
            <details>
              <summary>查看阶段理解</summary>
              <pre className="document-text">
                {m.markdown || "还没有阶段理解"}
              </pre>
            </details>
          </details>
        );
      })}
    </section>
  );
}
