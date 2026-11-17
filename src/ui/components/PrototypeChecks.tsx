import { useEffect, useState } from "react";
import {
  prototypeCheckNames,
  type PrototypeCheck,
  type PrototypeCheckKey,
} from "../../contracts/workbench";
import { desktop, errorText } from "../bridge";
export function PrototypeChecks({
  projectId,
  versionId,
  onChange,
}: {
  projectId: string;
  versionId: string;
  onChange: () => void;
}) {
  const [records, setRecords] = useState<PrototypeCheck[]>([]),
    [key, setKey] = useState<PrototypeCheckKey>("filter"),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void desktop()
      .workbench.checks(projectId, versionId)
      .then((v) => {
        if (active) setRecords(v);
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [projectId, versionId]);
  async function record(result: "passed" | "failed") {
    try {
      setRecords(
        await desktop().workbench.recordCheck(
          projectId,
          versionId,
          key,
          result,
          note,
        ),
      );
      setError("");
      setNote("");
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <details className="change-summary">
      <summary>
        交互检查：
        {records.some((r) => r.result === "failed")
          ? "存在失败项"
          : records.length === 6
            ? "6 项通过"
            : "待完成"}
      </summary>
      <p className="muted">
        请实际操作原型后记录结果。这是人工检查记录；记录失败会撤销此版本的通过状态。
      </p>
      <ul>
        {Object.entries(prototypeCheckNames).map(([k, name]) => (
          <li key={k}>
            {name}：
            {records.find((r) => r.key === k)?.result === "passed"
              ? "通过"
              : records.find((r) => r.key === k)?.result === "failed"
                ? "失败"
                : "未检查"}
            {records.find((r) => r.key === k)?.note &&
              ` · ${records.find((r) => r.key === k)!.note}`}
          </li>
        ))}
      </ul>
      <select
        aria-label="交互检查项目"
        value={key}
        onChange={(e) => setKey(e.target.value as PrototypeCheckKey)}
      >
        {Object.entries(prototypeCheckNames).map(([k, name]) => (
          <option value={k} key={k}>
            {name}
          </option>
        ))}
      </select>
      <input
        aria-label="交互检查说明"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="记录观察结果；失败时必须填写"
      />
      <button onClick={() => void record("passed")}>记录通过</button>
      <button disabled={!note.trim()} onClick={() => void record("failed")}>
        记录失败
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
