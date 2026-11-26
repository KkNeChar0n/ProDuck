import type { DiscoveryRun } from "../../contracts/discovery";
import { discoveryProgress } from "../../discovery/progress";
import { featureStates, verifiedFeature } from "../../discovery/features";
export function DiscoveryProgress({ run }: { run: DiscoveryRun }) {
  const progress = discoveryProgress(run);
  return (
    <section className="discovery-progress" aria-label="探索进度总览">
      <h3>
        {run.state === "running"
          ? "探索进行中"
          : run.state === "paused"
            ? "探索已暂停 · 尚未完成"
            : "阶段理解已更新 · 等待核对"}
      </h3>
      <div className="discovery-metrics">
        <div>
          <strong>
            已发现功能验证 {progress.total ? `${progress.percent}%` : "待梳理"}
          </strong>
          <progress
            max={100}
            value={progress.percent}
            aria-label="清单验证进度"
          />
          <small>
            {progress.done}/{progress.total} 项已验证 ·{" "}
            {progress.modules.length} 个已识别模块
          </small>
        </div>
        <div>
          <strong>本轮预算使用 {progress.budgetPercent}%</strong>
          <progress
            max={100}
            value={progress.budgetPercent}
            aria-label="本轮预算使用"
          />
          <small>
            {progress.used}/{progress.budget} 个页面状态 · 不代表完成度
          </small>
        </div>
      </div>
      <p>当前模块：{run.activeModule || "正在识别"}</p>
      <p className="muted">
        进度仅为已验证项占已发现功能的比例；发现新功能时可能下降。部分验证和受阻不计完成，100%也不代表穷尽整个产品。阶段理解须审核后才成为永久记忆。
      </p>
      {progress.modules.map((module) => (
        <details
          key={module.name}
          className="discovery-module-progress"
          open={run.activeModule === module.name}
        >
          <summary>
            {module.name} ·{" "}
            {module.total
              ? `已发现功能 ${module.percent}%（${module.done}/${module.total}）`
              : "功能清单待梳理"}{" "}
            ·{" "}
            {module.record?.state === "summarizing"
              ? "正在整理"
              : module.record?.markdown
                ? "阶段理解已保存"
                : "尚无阶段理解"}
          </summary>
          {module.total > 0 && (
            <progress
              max={100}
              value={module.percent}
              aria-label={`${module.name}功能进度`}
            />
          )}
          {!module.total && (
            <p className="muted">
              此模块尚未按实际功能梳理。继续探索将结合历史观察与当前页面补建清单，旧通用检查项不计完成度。
            </p>
          )}
          {module.features.map((item) => (
            <details key={item.name} className="discovery-feature">
              <summary>
                {item.name} · {featureStates[item.state]} · 验证{" "}
                {verifiedFeature(run, item) ? "100%" : "0%"}
              </summary>
              <p>
                <b>验证目标：</b>
                {item.goal}
              </p>
              <p>
                <b>实际结果：</b>
                {item.result || "尚无验证结果"}
              </p>
              <p>
                <b>剩余内容：</b>
                {item.remaining ||
                  (verifiedFeature(run, item)
                    ? "当前目标已验证，其他分支需另列功能项"
                    : "尚待核对")}
              </p>
              {item.blocker && (
                <p>
                  <b>受阻条件：</b>
                  {item.blocker}
                </p>
              )}
              <p>
                <b>下一步：</b>
                {item.nextAction || "当前目标已验证"}
              </p>
              <details>
                <summary>
                  查看依据（页面 {item.evidenceIds.length} · 资料{" "}
                  {item.sourceIds.length}）
                </summary>
                {item.evidenceIds.map((id) => {
                  const index = run.steps.findIndex((s) => s.captureId === id);
                  const step = run.steps[index];
                  return (
                    <p key={id}>
                      页面记录 {index >= 0 ? index + 1 : id}：
                      {step?.observation || "页面已采集"}
                      <br />
                      {step?.result}
                      <br />
                      <small>{id}</small>
                    </p>
                  );
                })}
                {item.sourceIds.map((id) => (
                  <p key={id}>
                    交接资料：{run.sources.find((s) => s.id === id)?.name || id}
                    （仅证明功能线索，不代表实际验证）
                  </p>
                ))}
              </details>
            </details>
          ))}
          <details>
            <summary>查看阶段理解</summary>
            {module.record?.error && <p>{module.record.error}</p>}
            {module.record?.markdown ? (
              <pre className="document-text">{module.record.markdown}</pre>
            ) : (
              <p>尚未整理；已有观察会在模块结束后自动保存。</p>
            )}
          </details>
        </details>
      ))}
    </section>
  );
}
