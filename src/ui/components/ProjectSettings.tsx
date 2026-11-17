import { useEffect, useState } from "react";
import type { Project, ProjectConnection } from "../../contracts/projects";
import { desktop, errorText } from "../bridge";
import { ModelSettings } from "./ModelSettings";
export function ProjectSettings({ project }: { project: Project }) {
  const [connections, setConnections] = useState<ProjectConnection[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    desktop()
      .projects.connections(project.id)
      .then((value) => {
        if (active) setConnections(value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(form);
    try {
      setConnections(
        await desktop().projects.saveConnection(project.id, {
          provider: data.get("provider") as ProjectConnection["provider"],
          url: String(data.get("url")),
        }),
      );
      setNotice("项目地址已保存；平台鉴权尚未接入。");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="paper">
      <h2>{project.name}</h2>
      <ModelSettings projectId={project.id} />
      <div className="info-row">
        <div>
          工作空间<small className="path">{project.workspace}</small>
        </div>
        <button
          onClick={() =>
            desktop()
              .projects.reveal(project.id)
              .catch((e) => setError(errorText(e)))
          }
        >
          在 Finder 中显示
        </button>
      </div>
      {(["feishu", "yunxiao"] as const).map((provider) => (
        <form
          className="connection-form"
          key={`${provider}-${connections.find((c) => c.provider === provider)?.url ?? ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <input type="hidden" name="provider" value={provider} />
          <label>
            {provider === "feishu" ? "飞书迭代文档地址" : "云效项目地址"}
            <input
              name="url"
              type="url"
              required
              defaultValue={
                connections.find((c) => c.provider === provider)?.url ?? ""
              }
              placeholder="https://…"
            />
          </label>
          <button disabled={busy}>保存地址</button>
        </form>
      ))}
      <p className="muted">
        每个项目独立保存连接地址。应用不会自动读取其他项目的配置。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}
