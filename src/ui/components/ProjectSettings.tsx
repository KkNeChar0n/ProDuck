import { useState } from "react";
import type { Project } from "../../contracts/projects";
import { desktop, errorText } from "../bridge";
import { ModelSettings } from "./ModelSettings";
import { PlatformSettings } from "./PlatformSettings";
export function ProjectSettings({ project }: { project: Project }) {
  const [error, setError] = useState("");
  return (
    <article className="paper">
      <h2>{project.name} · 项目设置</h2>
      <p className="muted">
        以下配置由本项目的所有版本共享。飞书迭代地址请点击版本右侧的齿轮设置。
      </p>
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
        模型、工作空间及平台凭证由项目共享。飞书迭代地址在版本设置中填写；原型、文档与交付记录按版本独立保存。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  );
}
