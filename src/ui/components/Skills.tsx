import { builtinWorkflows } from "../../skills/builtin";
import { useEffect, useState } from "react";
import type { ImportedSkill } from "../../contracts/skills";
import { desktop, errorText } from "../bridge";
export function Skills({
  projectId,
  onTasks,
  onWorkflow,
}: {
  projectId: string;
  onTasks: () => void;
  onWorkflow: (entry: "workbench" | "documents") => void;
}) {
  const [skills, setSkills] = useState<ImportedSkill[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void desktop()
      .skills.list(projectId)
      .then(setSkills)
      .catch((e) => setError(errorText(e)));
  }, [projectId]);
  return (
    <article className="paper">
      <h2>内置工作流</h2>
      <p>
        随 Produck 安装即可使用，无需另装 Node、Python 或 Agent
        CLI。模型与平台连接沿用当前项目设置。
      </p>
      {builtinWorkflows.map((workflow) => (
        <section className="notice" key={workflow.id}>
          <h3>{workflow.name}</h3>
          <p>{workflow.description}</p>
          <p className="muted">Produck 内置 · v{workflow.version}</p>
          {workflow.limitation && <p>{workflow.limitation}</p>}
          <details>
            <summary>步骤与使用条件</summary>
            <ol>
              {workflow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p>{workflow.requirements}</p>
            <p>{workflow.permissions}</p>
          </details>
          <button onClick={() => onWorkflow(workflow.entry)}>
            {workflow.action}
          </button>
        </section>
      ))}
      <h2>导入的 Skills</h2>
      <p>
        导入包含 SKILL.md 的文件夹。纯说明技能可供 Agent
        使用；脚本、外部命令和未适配工具会列出具体限制。
      </p>
      <button
        className="primary"
        onClick={async () => {
          try {
            const skill = await desktop().skills.import(projectId);
            if (skill) setSkills(await desktop().skills.list(projectId));
            setError("");
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        导入 Skill 文件夹
      </button>
      <button onClick={onTasks}>前往工作流选择技能</button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!skills.length && <p className="muted">还没有导入技能。</p>}
      {skills.map((skill) => (
        <section className="notice" key={skill.id}>
          <h3>
            {skill.name} ·{" "}
            {skill.status === "runnable"
              ? "可运行"
              : skill.status === "needs-approval"
                ? "操作时需授权"
                : "暂不支持运行"}
          </h3>
          <p>{skill.description}</p>
          <p className="muted">
            来源：{skill.source}
            <br />
            版本指纹：{skill.fingerprint.slice(0, 12)} ·{" "}
            {new Date(skill.importedAt).toLocaleString()}
          </p>
          {skill.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          {skill.mappings.map((m) => (
            <p key={m.requested}>
              {m.requested} → {m.provided}
            </p>
          ))}
          <details>
            <summary>{skill.resources.length} 个资源</summary>
            <ul>
              {skill.resources.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        </section>
      ))}
    </article>
  );
}
