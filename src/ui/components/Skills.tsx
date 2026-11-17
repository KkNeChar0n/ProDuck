import { useEffect, useState } from "react";
import type { ImportedSkill } from "../../contracts/skills";
import { desktop, errorText } from "../bridge";
export function Skills({
  projectId,
  onTasks,
}: {
  projectId: string;
  onTasks: () => void;
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
      <h2>项目 Skills</h2>
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
