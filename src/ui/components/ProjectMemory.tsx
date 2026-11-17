import { useEffect, useState } from "react";
import { desktop, errorText } from "../bridge";
export function ProjectMemory({ projectId }: { projectId: string }) {
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    desktop()
      .projects.memory(projectId)
      .then((v) => {
        if (active) setText(v);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <article className="paper">
      <h2>记忆.md</h2>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : (
        <pre className="memory-content">{text || "正在读取…"}</pre>
      )}
    </article>
  );
}
