import { useState } from "react";
import type { ImportedSkill, PythonRun } from "../../contracts/skills";
import { desktop, errorText } from "../bridge";
export function PythonSkillPanel({
  projectId,
  skill,
}: {
  projectId: string;
  skill: ImportedSkill;
}) {
  const [input, setInput] = useState("{}"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<PythonRun | null>(null),
    [error, setError] = useState("");
  return (
    <div>
      <p>
        Python 3.12 ·
        仅标准库。读取技能包，写入独立结果目录；网络与子进程禁止。每次运行单独授权，更新后按新版本复核。
      </p>
      <label>
        脚本输入（JSON）
        <textarea
          aria-label={`Python 输入 ${skill.id}`}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          maxLength={16000}
        />
      </label>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            JSON.parse(input);
            const row = await desktop().skills.runPython(
              projectId,
              skill.id,
              skill.fingerprint,
              input,
            );
            if (row) setResult(row);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在运行 Python…" : "运行 Python 脚本"}
      </button>
      {busy && (
        <button
          onClick={() =>
            desktop()
              .skills.cancelPython(projectId)
              .catch((e) => setError(errorText(e)))
          }
        >
          取消脚本
        </button>
      )}
      {result && (
        <>
          <p role="status">{result.message}</p>
          <pre className="document-text">{result.output}</pre>
          <button
            onClick={() =>
              desktop()
                .skills.revealPython(projectId, result.id)
                .catch((e) => setError(errorText(e)))
            }
          >
            查看本次结果
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
