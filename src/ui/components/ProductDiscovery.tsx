import { OverviewProgress } from "./OverviewProgress";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryState } from "../../contracts/discovery";
import { desktop, errorText } from "../bridge";
export function ProductDiscovery({ projectId }: { projectId: string }) {
  const [screenshotModule, setScreenshotModule] = useState("");
  const [screenshotDescription, setScreenshotDescription] = useState("");
  const reviewRef = useRef<HTMLElement>(null);
  const restoredBudget = useRef(false);
  const [state, setState] = useState<DiscoveryState>({
    run: null,
    reports: [],
    activeReportId: null,
  });
  const [url, setUrl] = useState(""),
    [goal, setGoal] = useState(""),
    [budget, setBudget] = useState(16);
  useEffect(() => {
    if (state.run && !restoredBudget.current) {
      restoredBudget.current = true;
      setBudget(
        Math.max(
          2,
          Math.min(
            30,
            state.run.mode === "overview"
              ? state.run.budget - (state.run.roundStart ?? 0)
              : 16,
          ),
        ),
      );
    }
  }, [state.run]);
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
        打开独立 Chrome → 登录 → 了解模块并采集页面 → 补图与审核 → 绘制原型 /
        写文档
      </p>
      <p>
        每个项目保留独立登录状态。可先在「交接资料」导入已有文档，Agent
        会了解系统用途和模块主要职责，采集代表页面的静态
        HTML、样式与截图。无需测试新建、编辑、校验或保存流程；采集不完整时可手动补图。
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
          placeholder="如：了解客户与订单模块的用途，采集列表、详情和主要操作弹窗"
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
            max={30}
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
        默认最多16个页面状态，可选2–30；每模块通常只看1个代表页面，必要时补1个关键弹窗。主要模块信息足够后即可整理并生成原型，不必跑满步数。继续探索只补充缺失页面，历史记录会复用。
      </p>
      <p className="muted">
        Agent
        仅浏览导航、展开菜单和采集页面，不主动填写表单或提交业务操作。静态HTML不包含原站脚本、服务端逻辑和登录凭证；画布、嵌入区域及外部图片可能需要截图补充。页面资料会发送给项目模型，补图生成原型需要支持图像的模型。
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state.run && (
        <section className="notice">
          <OverviewProgress
            run={state.run}
            exportPage={(id) =>
              void act(() => desktop().discovery.exportPage(projectId, id))
            }
          />
          <p role="status">
            <strong>{state.run.message}</strong>
            {state.run.stopReason && (
              <p>
                模型结束本轮的原因：{state.run.stopReason}
                （步数是上限，不代表必须跑满。）
              </p>
            )}
            {!!state.run.retries?.length && (
              <details>
                <summary>
                  自动重试记录（最近 {state.run.retries.length} 次）
                </summary>
                {state.run.retries.map((r, i) => (
                  <p key={i}>
                    {new Date(r.at).toLocaleTimeString()} · {r.stage} · 重试{" "}
                    {r.attempt}/3：{r.error}
                  </p>
                ))}
              </details>
            )}
          </p>
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
          {["draft", "paused"].includes(state.run.state) && (
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
                复用已有理解和页面资料，只补充缺失模块或代表页面；新增步数使用上方设置（当前{" "}
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
                disabled={busy || !state.run.captureIds.length}
                onClick={() =>
                  void act(() =>
                    desktop().discovery.summarize(projectId, state.run!.id),
                  )
                }
              >
                仅整理并结束本轮
              </button>
            </div>
          )}
          <section aria-label="补充页面截图">
            <h3>HTML 不完整？补充页面截图</h3>
            <select
              aria-label="截图所属模块"
              value={screenshotModule}
              onChange={(e) => setScreenshotModule(e.target.value)}
              disabled={busy || running}
            >
              <option value="">选择截图所属模块</option>
              {state.run.modules?.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              aria-label="截图内容说明"
              placeholder="如：编排画布的节点与连线布局"
              value={screenshotDescription}
              maxLength={1000}
              onChange={(e) => setScreenshotDescription(e.target.value)}
              disabled={busy || running}
            />
            <button
              disabled={
                busy ||
                running ||
                !screenshotModule ||
                !screenshotDescription.trim()
              }
              onClick={() =>
                void act(async () => {
                  const result = await desktop().discovery.supplement(
                    projectId,
                    state.run!.id,
                    screenshotModule,
                    screenshotDescription,
                  );
                  if (result) {
                    setScreenshotDescription("");
                    setNotice(
                      "截图已关联到模块。请审核新草稿后生成原型，旧批准记录保留。",
                    );
                  }
                })
              }
            >
              选择 PNG / JPEG 截图
            </button>
            <p className="muted">
              每张不超过20MB；补图后需重新审核。生成时最多使用最近6张补图，请优先提供关键页面。
            </p>
          </section>
          <details>
            <summary>查看探索记录与未覆盖项</summary>
            {state.run.steps.map((s, i) => (
              <section key={`${s.captureId}-${i}`}>
                <strong>
                  {i + 1}. {s.observation || "页面已采集"}
                </strong>
                <p className="muted">
                  采集 100% · 观察决策{" "}
                  {s.observation && s.action ? "100%" : "0%"} ·{" "}
                  {s.action &&
                  ["finish", "complete-module"].includes(s.action.kind)
                    ? "无需浏览器操作"
                    : `操作 ${s.executed ? "100%（已执行，结果仍需核对）" : "0%（未完成或已跳过）"}`}
                </p>
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
