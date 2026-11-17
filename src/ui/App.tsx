import { ProjectSources } from "./components/ProjectSources";
import { AgentPanel } from "./components/AgentPanel";
import { useEffect, useState } from "react";
import type { WorkspaceState } from "../contracts/projects";
import { desktop, errorText } from "./bridge";
import { CreateProject } from "./components/CreateProject";
import { ProjectSettings } from "./components/ProjectSettings";
import { ProjectMemory } from "./components/ProjectMemory";
type View =
  "workbench" | "memory" | "documents" | "workflow" | "skills" | "settings";
const navigation: [View, string, string][] = [
  ["workbench", "▧", "工作台"],
  ["memory", "▤", "项目记忆"],
  ["documents", "▱", "文档"],
  ["workflow", "⑂", "工作流"],
  ["skills", "✧", "Skills"],
];
export function App() {
  const [state, setState] = useState<WorkspaceState>({
      projects: [],
      activeProjectId: null,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [view, setView] = useState<View>("workbench"),
    [tab, setTab] = useState("browser"),
    [collapsed, setCollapsed] = useState(false),
    [creating, setCreating] = useState(false),
    [switching, setSwitching] = useState(false);
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setState(await desktop().projects.state());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function select(id: string) {
    setSwitching(true);
    setError("");
    try {
      setState(await desktop().projects.select(id));
      setView("workbench");
      setTab("browser");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSwitching(false);
    }
  }
  const title =
    view === "workbench"
      ? "从一个页面开始"
      : (navigation.find((v) => v[0] === view)?.[2] ?? "项目设置");
  return (
    <div className={`app ${collapsed ? "nav-collapsed" : ""}`}>
      <header className="titlebar">
        <button
          className="icon"
          aria-label="收起或展开导航"
          onClick={() => setCollapsed(!collapsed)}
        >
          ☷
        </button>
        <strong className="wordmark">
          produck
          <span className="brand-dot" />
        </strong>
        <span className="title-path">你的产品工作空间</span>
        <span className="demo-badge">本地项目 · 开发预览</span>
        <button
          className="quiet"
          disabled={!project}
          onClick={() => setView("settings")}
        >
          项目设置
        </button>
      </header>
      <aside className="sidebar">
        <div className="project-label">
          当前项目
          <button
            className="icon"
            aria-label="创建项目"
            onClick={() => setCreating(true)}
          >
            ＋
          </button>
        </div>
        <select
          aria-label="切换项目"
          id="project-select"
          value={state.activeProjectId ?? ""}
          disabled={loading || switching || !project}
          onChange={(e) => void select(e.target.value)}
        >
          {!project && <option value="">还没有项目</option>}
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <nav>
          {navigation.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav ${view === id ? "active" : ""}`}
              onClick={() => setView(id)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">本次任务</div>
        <div className="task-entry">
          <span className="live-dot" />
          {project ? "等待导入页面" : "先创建一个项目"}
        </div>
        <div className="sidebar-note">
          从一个页面开始，
          <br />
          让想法成为可交付的方案。
        </div>
        <button
          className={`nav bottom ${view === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}
        >
          <span>⚙</span>项目设置
        </button>
        <div className="profile">
          <span className="avatar">P</span>
          <div>
            本地工作空间<small>文件由你掌握</small>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <section className="work-heading">
          <div>
            <div className="breadcrumb">
              {project?.name ?? "Produck"} /{" "}
              {view === "workbench" ? "工作台" : title}
            </div>
            <h1>{title}</h1>
          </div>
          {project && (
            <button
              className="quiet"
              onClick={() =>
                desktop()
                  .projects.reveal(project.id)
                  .catch((e) => setError(errorText(e)))
              }
            >
              打开工作空间
            </button>
          )}
        </section>
        <div className="workspace-body">
          {error && (
            <div className="notice" role="alert">
              {error} <button onClick={() => void refresh()}>重试</button>
            </div>
          )}
          {loading || switching ? (
            <div className="empty">正在读取项目…</div>
          ) : !project ? (
            <div className="empty">
              <h2>给你的产品一个工作空间</h2>
              <p>项目资料、原型和文档将保存在你选择的文件夹中。</p>
              <button className="primary" onClick={() => setCreating(true)}>
                创建第一个项目
              </button>
            </div>
          ) : view === "settings" ? (
            <ProjectSettings key={project.id} project={project} />
          ) : view === "memory" ? (
            <ProjectMemory key={project.id} projectId={project.id} />
          ) : view === "workbench" ? (
            <>
              <div className="tabs" role="tablist">
                {[
                  ["browser", "浏览器"],
                  ["prototype", "原型"],
                  ["document", "文档"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={`tab ${tab === id ? "active" : ""}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "browser" ? (
                <ProjectSources key={project.id} projectId={project.id} />
              ) : (
                <div className="empty canvas">
                  <h2>
                    {tab === "browser"
                      ? "准备理解你的产品"
                      : tab === "prototype"
                        ? "还没有原型"
                        : "还没有文档"}
                  </h2>
                  <p>
                    {tab === "browser"
                      ? "工作空间已准备好。可以配置模型开始讨论。网页采集将在后续任务中接入。"
                      : tab === "prototype"
                        ? "原型将根据页面依据生成，并保留每次修改的版本。"
                        : "通过原型后，可在这里审阅需求文档。"}
                  </p>
                  <button onClick={() => setView("settings")}>
                    配置项目地址
                  </button>
                </div>
              )}
            </>
          ) : (
            <article className="paper">
              <h2>{title}</h2>
              <p>
                {view === "documents"
                  ? "此项目还没有生成文档。"
                  : view === "workflow"
                    ? "此项目尚无执行任务。"
                    : "Skill 运行器尚未接入。"}
              </p>
              <button onClick={() => setView("workbench")}>返回工作台</button>
            </article>
          )}
        </div>
        <footer className="stagebar">
          <div>
            <span className="stage-dot" />
            {project ? "工作空间已就绪" : "等待创建项目"}
            <small>
              {project
                ? "项目与连接地址已保存在本机"
                : "选择一个文件夹，开始新的项目"}
            </small>
          </div>
          <button
            className="primary"
            onClick={() => (project ? setView("settings") : setCreating(true))}
          >
            {project ? "配置项目" : "创建项目"}
          </button>
        </footer>
      </main>
      <AgentPanel
        key={project?.id ?? "empty"}
        project={project}
        onSettings={() => setView("settings")}
      />
      {creating && (
        <CreateProject
          onClose={() => setCreating(false)}
          onCreated={(value) => {
            setState(value);
            setCreating(false);
            setView("settings");
            setError("");
          }}
        />
      )}
    </div>
  );
}
