import { useState } from "react";
import type { Project } from "../../contracts/projects";
import { desktop, errorText } from "../bridge";
import { ModelSettings } from "./ModelSettings";
import { PlatformSettings } from "./PlatformSettings";
export function ProjectSettings({ project }: { project: Project }) {
  const [error, setError] = useState("");
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
        <PlatformSettings
          key={`${project.id}-${provider}`}
          projectId={project.id}
          provider={provider}
        />
      ))}
      <p className="muted">
        连接及凭证按项目隔离。飞书首次发布在文档页操作；飞书发布成功后可按配置同步云效状态。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  );
}
