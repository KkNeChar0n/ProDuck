import type { ImportedSkill } from "../../contracts/skills";
import { useEffect, useState } from "react";
import type { AgentRun } from "../../contracts/agent";
import { desktop, errorText } from "../bridge";
const names: Record<string, string> = {
  delivery_records: "查看交付记录",
  prepare_publication: "准备发布材料",
  fetch_published_prd: "读取线上文档",
  read_prd_section: "读取文档章节",
  prepare_prd_change: "准备文档差异",
  prepare_yunxiao_sync: "准备云效同步",
  product_artifacts: "查看原型与文档成果",
  generate_prototype: "生成候选原型",
  generate_prd: "生成 PRD 草稿",
  read_prd: "读取 PRD 草稿",
  project_sources: "查看项目资料",
  read_source: "读取交接资料",
  search_memory: "检索项目记忆",
  read_prototype: "读取原型",
  write_note: "保存工作笔记",
  browser_open: "打开真实网页",
  browser_capture: "采集真实网页",
  browser_action: "操作真实网页",
};
export function AgentTasks({ projectId }: { projectId: string }) {
  const [skills, setSkills] = useState<ImportedSkill[]>([]),
    [skillId, setSkillId] = useState("");
  const [runs, setRuns] = useState<AgentRun[]>([]),
    [goal, setGoal] = useState(""),
    [budget, setBudget] = useState(6),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    void desktop()
      .skills.list(projectId)
      .then((v) => {
        if (active) setSkills(v);
      })
      .catch((e) => setError(errorText(e)));
    void desktop()
      .agent.list(projectId)
      .then((v) => {
        if (active) setRuns(v);
      })
      .catch((e) => setError(errorText(e)));
    const off = desktop().agent.onEvent((run) => {
      if (run.projectId === projectId)
        setRuns((items) => [run, ...items.filter((r) => r.id !== run.id)]);
    });
    return () => {
      active = false;
      off();
    };
  }, [projectId]);
  const busy = runs.some((r) => ["running", "waiting-user"].includes(r.state));
  async function perform(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <section className="paper">
      <h2>Agent 任务</h2>
      <p className="muted">
        Agent 可按需读取当前项目资料并发送给项目模型。保存笔记、生成候选原型/PRD
        、准备平台材料和读取线上文档、操作真实网页前，会列出具体内容等待你批准。生成后请到工作台或文档页审阅；通过版本和发布仍需独立确认。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        使用技能{" "}
        <select
          aria-label="Agent 技能"
          value={skillId}
          disabled={busy}
          onChange={(e) => setSkillId(e.target.value)}
        >
          <option value="">不使用技能</option>
          {skills
            .filter((s) => s.status !== "unsupported" && !s.python)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <textarea
        aria-label="Agent 任务要求"
        placeholder="例如：读取交接资料，整理待确认问题并保存笔记"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={busy}
      />
      <label>
        最多工具步骤{" "}
        <select
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          disabled={busy}
        >
          {[3, 6, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary"
        disabled={busy || !goal.trim()}
        onClick={() =>
          void perform(() =>
            desktop().agent.start(
              projectId,
              goal,
              budget,
              skillId || undefined,
            ),
          )
        }
      >
        执行任务
      </button>
      {runs.map((run) => (
        <article className="notice" key={run.id}>
          <strong>{run.goal}</strong>
          <p role="status">{run.message}</p>
          <ol>
            {run.steps.map((step) => (
              <li key={step.id}>
                <strong>{names[step.call.tool] ?? step.call.tool}</strong> ·{" "}
                {
                  {
                    "waiting-user": "等待批准",
                    running: "执行中",
                    succeeded: "已完成",
                    failed: "失败",
                    interrupted: "待核对",
                  }[step.state]
                }
                {step.approvalContext && (
                  <p>目标页面：{step.approvalContext.label}</p>
                )}
                <pre className="document-text">
                  {JSON.stringify(step.call.args, null, 2)}
                </pre>
                {step.output && (
                  <details>
                    <summary>执行结果</summary>
                    <pre className="document-text">{step.output}</pre>
                  </details>
                )}
                {step.state === "waiting-user" && (
                  <div>
                    <button
                      className="primary"
                      onClick={() =>
                        void perform(() =>
                          desktop().agent.approve(
                            projectId,
                            run.id,
                            step.id,
                            true,
                          ),
                        )
                      }
                    >
                      批准这一步
                    </button>
                    <button
                      onClick={() =>
                        void perform(() =>
                          desktop().agent.approve(
                            projectId,
                            run.id,
                            step.id,
                            false,
                          ),
                        )
                      }
                    >
                      拒绝并停止
                    </button>
                  </div>
                )}
                {step.state === "interrupted" && (
                  <div>
                    <p>
                      操作结果不确定。请先检查页面或文件，再填写核对结果；应用不会自动重做。
                    </p>
                    <input
                      aria-label="中断步骤核对结果"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="说明该操作是否已完成及实际结果"
                    />
                    <button
                      disabled={!note.trim()}
                      onClick={() =>
                        void perform(() =>
                          desktop().agent.resolve(
                            projectId,
                            run.id,
                            step.id,
                            note,
                          ),
                        )
                      }
                    >
                      保存核对记录
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {["running", "waiting-user"].includes(run.state) ? (
            <button
              onClick={() =>
                void perform(() => desktop().agent.cancel(projectId))
              }
            >
              取消任务
            </button>
          ) : (
            ["interrupted", "failed", "cancelled"].includes(run.state) &&
            run.steps.length < run.budget && (
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() => desktop().agent.resume(projectId, run.id))
                }
              >
                从记录继续
              </button>
            )
          )}
        </article>
      ))}
    </section>
  );
}
