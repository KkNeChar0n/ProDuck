import { checks, checkNames } from "../../discovery/coverage";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryState } from "../../contracts/discovery";
import { desktop, errorText } from "../bridge";
export function ProductDiscovery({ projectId }: { projectId: string }) {
  const reviewRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<DiscoveryState>({
    run: null,
    reports: [],
    activeReportId: null,
  });
  const [url, setUrl] = useState(""),
    [goal, setGoal] = useState(""),
    [budget, setBudget] = useState(40);
  const [selected, setSelected] = useState(""),
    [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const refresh = async () => {
    const result = await desktop().discovery.state(projectId);
    setState(result);
    return result;
  };
  useEffect(() => {
    let alive = true,
      loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await desktop().discovery.state(projectId);
        if (alive) setState(result);
      } catch (e) {
        if (alive) setError(errorText(e));
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer =
      state.run?.state === "running"
        ? setInterval(() => void poll(), 1200)
        : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, state.run?.state]);
  useEffect(() => {
    if (state.reports.length && !selected)
      setSelected(state.run?.reportId ?? state.reports[0].id);
  }, [state, selected]);
  useEffect(() => {
    if (state.run?.reportId) setSelected(state.run.reportId);
  }, [state.run?.reportId]);
  const report = state.reports.find((r) => r.id === selected);
  useEffect(() => {
    setMarkdown(report?.markdown ?? "");
  }, [report?.id]);
  const running = state.run?.state === "running",
    dirty = !!report && markdown !== report.markdown;
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="paper discovery">
      <h2>让 Agent 理解产品</h2>
      <p className="muted">
        打开独立 Chrome → 登录 → 自动体验 → 审核模块理解 → 长期记忆与可修改原型
      </p>
      <p>
        每个项目保留独立登录状态。可先在「交接资料」导入已有文档，Agent
        会结合页面与资料整理理解。默认深入体验各模块的新建和编辑，包括字段、校验、取消与保存结果。
      </p>
      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await desktop().discovery.open(projectId, url);
            setNotice(
              "Chrome 已打开。请完成登录并停在产品首页，再点击授权并开始自动体验。",
            );
          });
        }}
      >
        <input
          aria-label="产品 Chrome 地址"
          placeholder="https://你的产品地址"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button disabled={busy || running}>打开独立 Chrome</button>
      </form>
      <label>
        本轮关注范围（可选）
        <textarea
          aria-label="产品理解目标"
          rows={2}
          maxLength={2000}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="如：优先体验客户与订单模块，检查新建、编辑、字段联动和状态变化"
          disabled={busy || running}
        />
      </label>
      <div className="discovery-actions">
        <label>
          探索步数{" "}
          <input
            aria-label="探索步数"
            aria-describedby="discovery-budget-help"
            type="number"
            min={2}
            max={120}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            disabled={busy || running}
          />
        </label>
        <button
          className="primary"
          disabled={busy || running}
          onClick={() =>
            void act(async () => {
              await desktop().discovery.start(projectId, goal, budget);
              setSelected("");
            })
          }
        >
          {state.run ? "重新探索" : "授权并开始自动体验"}
        </button>
        {running && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() => desktop().discovery.cancel(projectId))
            }
          >
            暂停自动体验
          </button>
        )}
      </div>
      <p className="muted" id="discovery-budget-help">
        默认 40 步，常规包含新建与编辑。单模块可选 20–40 步，多个模块可选 60–120
        步。
        一步是观察一次页面状态并决定下一步操作；弹窗和筛选结果也可能各占一步，不等于模块数量。
        步数越多通常耗时和模型用量越高，Agent
        也可能提前结束；达到上限后会整理已有依据，不代表已完整理解产品。可点击「继续探索」增加一轮预算；「重新探索」则从头建立新清单。
      </p>
      <p className="muted">
        授权后，Agent
        将自行点击、输入、展开菜单并体验当前站点，普通操作失败会重新观察或换路。涉及业务数据修改时会单次确认，确认后仍由
        Agent
        执行。页面文字、元素和交接资料将发送给项目模型，截图留在本地。Chrome
        中手动登录即可，无需配置调试端口。
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state.run && (
        <section className="notice">
          <strong>{state.run.message}</strong>
          {state.run.reportId && (
            <button
              onClick={() =>
                reviewRef.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                })
              }
            >
              查看理解草稿
            </button>
          )}
          <p>
            本轮已观察{" "}
            {state.run.captureIds.length - (state.run.roundStart ?? 0)} /{" "}
            {state.run.budget - (state.run.roundStart ?? 0)} 个页面状态 · 累计{" "}
            {state.run.captureIds.length} 个
          </p>
          {state.run.state === "draft" && (
            <div>
              <button
                className="primary"
                disabled={busy || running || dirty}
                onClick={() =>
                  void act(async () => {
                    await desktop().discovery.continueExploration(
                      projectId,
                      state.run!.id,
                      budget,
                    );
                    setNotice(
                      `继续探索已启动，本轮新增 ${budget} 步预算；旧报告保留，新结果仍需审核。`,
                    );
                  })
                }
              >
                继续探索
              </button>
              <p className="muted">
                沿用已有依据与覆盖清单，优先补齐未完成项；新增步数使用上方设置（当前{" "}
                {budget} 步）。Chrome 关闭后请先重新打开。
                {dirty
                  ? "请先保存当前草稿修改。"
                  : "旧报告和已审核记忆不会被覆盖。"}
              </p>
            </div>
          )}
          {state.run.state === "paused" && (
            <div className="discovery-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    desktop().discovery.resume(projectId, state.run!.id),
                  )
                }
              >
                授权并继续自动体验
              </button>
              <button
                disabled={busy || !state.run.captureIds.length}
                onClick={() =>
                  void act(() =>
                    desktop().discovery.summarize(projectId, state.run!.id),
                  )
                }
              >
                先整理已有依据
              </button>
            </div>
          )}
          {!!state.run.coverage?.length && (
            <details open>
              <summary>新建与编辑体验清单</summary>
              <p className="muted">
                按页面依据评估，未勾选不代表系统没有该功能。校验约束与页面提示行为分别核对。
              </p>
              {state.run.coverage.map((row) => (
                <section key={`${row.module}-${row.flow}`}>
                  <strong>
                    {row.module} · {row.flow === "create" ? "新建" : "编辑"}（
                    {row.checks.length}/5）
                  </strong>
                  <p>
                    {checks
                      .map(
                        (c) =>
                          `${row.checks.includes(c) ? "✓" : "○"} ${checkNames[c]}`,
                      )
                      .join(" · ")}
                  </p>
                  {row.detail && <p>{row.detail}</p>}
                  {row.limitation && <p>未覆盖原因：{row.limitation}</p>}
                </section>
              ))}
            </details>
          )}
          <details>
            <summary>查看探索记录与未覆盖项</summary>
            {state.run.steps.map((s, i) => (
              <section key={`${s.captureId}-${i}`}>
                <strong>
                  {i + 1}. {s.observation || "页面已采集"}
                </strong>
                <p>{s.result}</p>
              </section>
            ))}
          </details>
        </section>
      )}
      {!!state.reports.length && (
        <section className="understanding-review" ref={reviewRef}>
          <h3>审核产品理解</h3>
          <select
            aria-label="产品理解版本"
            value={selected}
            disabled={busy || running}
            onChange={(e) => {
              if (
                dirty &&
                !window.confirm("切换将丢弃尚未保存的修改，继续吗？")
              )
                return;
              setSelected(e.target.value);
            }}
          >
            {state.reports.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString()} ·{" "}
                {r.id === state.activeReportId
                  ? "当前长期记忆"
                  : r.approvedAt
                    ? "历史已审核"
                    : "待审核"}
              </option>
            ))}
          </select>
          {report && (
            <>
              <p className="muted">
                核对模块、流程、来源、冲突与待验证事项。可直接修改
                Markdown；保存修订后再审核。新草稿不会覆盖已有长期记忆。
              </p>
              <textarea
                className="understanding-markdown"
                aria-label="模块理解 Markdown"
                rows={20}
                value={markdown}
                maxLength={60000}
                disabled={busy || running}
                onChange={(e) => setMarkdown(e.target.value)}
              />
              <div className="discovery-actions">
                <button
                  disabled={busy || running || !dirty || !markdown.trim()}
                  onClick={() =>
                    void act(async () => {
                      const next = await desktop().discovery.revise(
                        projectId,
                        report.id,
                        report.digest,
                        markdown,
                      );
                      setState((s) => ({
                        ...s,
                        reports: [next, ...s.reports],
                      }));
                      setSelected(next.id);
                    })
                  }
                >
                  保存修订
                </button>
                <button
                  className="primary"
                  disabled={busy || running || dirty}
                  onClick={() =>
                    void act(async () => {
                      if (!report.approvedAt)
                        await desktop().discovery.approve(
                          projectId,
                          report.id,
                          report.digest,
                        );
                      await refresh();
                      setNotice(
                        "理解已保存为长期记忆，正在生成统一原型；生成失败也可保留记忆并重试。",
                      );
                      await desktop().discovery.generate(
                        projectId,
                        report.id,
                        report.digest,
                      );
                    })
                  }
                >
                  {report.approvedAt
                    ? "基于此理解生成原型"
                    : "审核通过并生成原型"}
                </button>
                {!report.approvedAt && (
                  <button
                    disabled={busy || running || dirty}
                    onClick={() =>
                      void act(() =>
                        desktop().discovery.approve(
                          projectId,
                          report.id,
                          report.digest,
                        ),
                      )
                    }
                  >
                    仅审核并保存记忆
                  </button>
                )}
              </div>
              <small>
                通过后为项目共享的长期记忆；原型保存到当前产品版本。历史记录和依据仍保留。
              </small>
            </>
          )}
        </section>
      )}
    </article>
  );
}
