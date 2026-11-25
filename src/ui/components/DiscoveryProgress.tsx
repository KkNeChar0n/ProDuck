import type { DiscoveryRun } from "../../contracts/discovery";
import { discoveryProgress } from "../../discovery/progress";
import { checkNames } from "../../discovery/coverage";
export function DiscoveryProgress({ run }: { run: DiscoveryRun }) {
  const progress = discoveryProgress(run);
  return (
    <section className="discovery-progress" aria-label="探索进度总览">
      <h3>
        {run.state === "running"
          ? "探索进行中"
          : run.state === "paused"
            ? "探索已暂停 · 尚未完成"
            : "本轮已整理 · 等待核对"}
      </h3>
      <div className="discovery-metrics">
        <div>
          <strong>清单验证进度 {progress.percent}%</strong>
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
      <p>
        当前模块：{run.activeModule || "正在识别"} · 已整理{" "}
        {progress.modules.filter((m) => m.summaryPercent === 100).length}/
        {progress.modules.length} 个模块
      </p>
      <p className="muted">
        百分比按新建、编辑各5项检查计算，不代表整个产品已理解的比例。单项 0%
        为未验证，100% 为已有验证依据；阶段理解已整理也可能有缺口。
      </p>
      {progress.modules.map((module) => (
        <details
          key={module.name}
          className="discovery-module-progress"
          open={run.activeModule === module.name}
        >
          <summary>
            {module.name} · 清单 {module.percent}%（{module.done}/{module.total}
            ）· 整理 {module.summaryPercent}%
          </summary>
          <progress
            max={100}
            value={module.percent}
            aria-label={`${module.name}清单进度`}
          />
          {module.flows.map((flow) => (
            <div key={flow.flow}>
              <strong>
                {flow.flow === "create" ? "新建" : "编辑"} · {flow.percent}%（
                {flow.done}/{flow.total}）
              </strong>
              <div className="discovery-check-grid">
                {flow.checks.map((item) => (
                  <span
                    key={item.check}
                    className={item.percent === 100 ? "verified" : ""}
                  >
                    {checkNames[item.check]} <b>{item.percent}%</b>
                  </span>
                ))}
              </div>
              {flow.limitation && (
                <p className="muted">未完成原因：{flow.limitation}</p>
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}
