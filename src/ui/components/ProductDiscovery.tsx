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
    [budget, setBudget] = useState(12);
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
        会结合页面与资料整理理解。
      </p>
      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await desktop().discovery.open(projectId, url);
            setNotice(
              "Chrome 已打开。请完成登录并停在产品首页，再点击开始理解。",
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
          placeholder="如：重点理解证书申请、部署、续期与告警流程"
          disabled={busy || running}
        />
      </label>
      <div className="discovery-actions">
        <label>
          探索步数{" "}
          <input
            aria-label="探索步数"
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
          已登录，开始理解产品
        </button>
        {running && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() => desktop().discovery.cancel(projectId))
            }
          >
            暂停并手动接管
          </button>
        )}
      </div>
      <p className="muted">
        开始后，页面文字、元素和交接资料将发送给项目模型。自动体验查看、筛选和展开流程；保存、提交、删除等转为手动操作。截图保存在本地供核对。Chrome
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
            已观察 {state.run.captureIds.length} 个页面状态 · 本轮预算{" "}
            {state.run.budget} 步
          </p>
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
                从 Chrome 当前页面继续
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
                maxLength={18000}
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
