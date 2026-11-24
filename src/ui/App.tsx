import { ReleaseSettings } from "./components/ReleaseSettings";
import { Skills } from "./components/Skills";
import { Documents } from "./components/Documents";
import { Workbench, type PrototypeContext } from "./components/Workbench";
import { TaskHistory } from "./components/TaskHistory";
import { AgentPanel } from "./components/AgentPanel";
import { useEffect, useState } from "react";
import type { WorkspaceState } from "../contracts/projects";
import { desktop, errorText } from "./bridge";
import { CreateProject } from "./components/CreateProject";
import { ProjectSettings } from "./components/ProjectSettings";
import { ProjectMemory } from "./components/ProjectMemory";
type View =
  | "release-settings"
  | "memory"
  | "workbench"
  | "documents"
  | "workflow"
  | "skills"
  | "settings";
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
      releases: [],
      activeReleaseId: null,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [view, setView] = useState<View>("workbench"),
    [collapsed, setCollapsed] = useState(false),
    [creating, setCreating] = useState(false),
    [releaseName, setReleaseName] = useState(""),
    [creatingRelease, setCreatingRelease] = useState(false),
    [switching, setSwitching] = useState(false),
    [prototypeContext, setPrototypeContext] = useState<PrototypeContext | null>(
      null,
    );
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const release = state.releases.find((r) => r.id === state.activeReleaseId);
  const contextProject =
    project && release
      ? {
          ...project,
          id: release.id,
          name: `${project.name} / ${release.name}`,
        }
      : undefined;
  async function selectRelease(id: string) {
    if (!project) return;
    setSwitching(true);
    setError("");
    setPrototypeContext(null);
    try {
      await desktop().workbench.hide();
      setState(await desktop().releases.select(project.id, id));
      setView("workbench");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSwitching(false);
    }
  }
  async function createRelease() {
    if (!project) return;
    setSwitching(true);
    setError("");
    try {
      setState(await desktop().releases.create(project.id, releaseName));
      setCreatingRelease(false);
      setReleaseName("");
      setPrototypeContext(null);
      setView("release-settings");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSwitching(false);
    }
  }
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
      setPrototypeContext(null);
      setState(await desktop().projects.select(id));
      setView("workbench");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSwitching(false);
    }
  }
  const title =
    view === "workbench"
      ? "从理解产品开始"
      : view === "release-settings"
        ? "版本设置"
        : (navigation.find((v) => v[0] === view)?.[2] ?? "项目设置");
  return (
    <div className={`app ${collapsed ? "nav-collapsed" : ""}`}>
      <header className="titlebar">
        <button
          className="icon"
          aria-label={collapsed ? "展开导航" : "收起导航"}
          title={collapsed ? "展开导航" : "收起导航"}
          aria-expanded={!collapsed}
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
        <div className="scope-selector">
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
          <button
            className="icon scope-settings"
            aria-label="项目设置"
            title="项目设置：模型、工作空间、飞书凭证与云效"
            aria-pressed={view === "settings"}
            disabled={!project || switching}
            onClick={() => setView("settings")}
          >
            ⚙
          </button>
        </div>
        {project && (
          <>
            <div className="project-label">
              当前版本
              <button
                className="icon"
                aria-label="创建版本"
                onClick={() => setCreatingRelease(true)}
              >
                ＋
              </button>
            </div>
            <div className="scope-selector">
              <select
                aria-label="切换版本"
                value={release?.id ?? ""}
                disabled={switching}
                onChange={(e) => void selectRelease(e.target.value)}
              >
                {!release && <option value="">请创建版本</option>}
                {state.releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                className="icon scope-settings"
                aria-label="版本设置"
                title="版本设置：版本名称、飞书迭代地址与原型起点"
                aria-pressed={view === "release-settings"}
                disabled={!release || switching}
                onClick={() => setView("release-settings")}
              >
                ⚙
              </button>
            </div>
          </>
        )}
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
          {project ? "理解产品与整理资料" : "先创建一个项目"}
        </div>
        <div className="sidebar-note">
          从理解产品开始，
          <br />
          让想法成为可交付的方案。
        </div>
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
              {view !== "settings" && `${release?.name ?? "尚无版本"} / `}
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
          ) : !release ? (
            <div className="empty">
              <h2>为项目创建第一个版本</h2>
              <p>在版本中设计原型、撰写文档，并配置飞书迭代地址。</p>
              <button
                className="primary"
                onClick={() => setCreatingRelease(true)}
              >
                创建版本
              </button>
            </div>
          ) : view === "release-settings" ? (
            <ReleaseSettings
              key={release.id}
              release={release}
              releases={state.releases}
              onUpdated={() => {
                void desktop().projects.state().then(setState);
              }}
            />
          ) : view === "memory" ? (
            <ProjectMemory key={release.id} projectId={release.id} />
          ) : view === "documents" ? (
            <Documents key={release.id} projectId={release.id} />
          ) : view === "skills" ? (
            <Skills
              key={release.id}
              projectId={release.id}
              onTasks={() => setView("workflow")}
              onWorkflow={setView}
            />
          ) : view === "workflow" ? (
            <TaskHistory key={release.id} projectId={release.id} />
          ) : view === "workbench" ? (
            <Workbench
              key={release.id}
              projectId={release.id}
              visible={!creating && !creatingRelease}
              onContext={setPrototypeContext}
            />
          ) : (
            <article className="paper">
              <h2>{title}</h2>
              <p>Skill 运行器尚未接入。</p>
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
          {!project && (
            <button className="primary" onClick={() => setCreating(true)}>
              创建项目
            </button>
          )}
        </footer>
      </main>
      <AgentPanel
        key={release?.id ?? "empty"}
        project={contextProject}
        onSettings={() => setView("settings")}
        prototypeContext={view === "workbench" ? prototypeContext : null}
      />
      {creatingRelease && (
        <div className="release-modal">
          <form
            className="paper"
            onSubmit={(e) => {
              e.preventDefault();
              void createRelease();
            }}
          >
            <h2>创建产品版本</h2>
            <label>
              版本名称
              <input
                aria-label="新版本名称"
                autoFocus
                required
                maxLength={80}
                value={releaseName}
                placeholder="例如 V1.0.0"
                onChange={(e) => setReleaseName(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              disabled={switching}
              onClick={() => setCreatingRelease(false)}
            >
              取消
            </button>{" "}
            <button className="primary" disabled={switching}>
              创建版本
            </button>
          </form>
        </div>
      )}
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
