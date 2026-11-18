import { useEffect, useState } from "react";
import type { YunxiaoSync } from "../../contracts/yunxiao";
import { desktop, errorText } from "../bridge";
export function YunxiaoSyncPanel({
  projectId,
  publicationId,
}: {
  projectId: string;
  publicationId: string;
}) {
  const [rows, setRows] = useState<YunxiaoSync[]>([]),
    [itemId, setItemId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    desktop()
      .yunxiaoSync.list(projectId)
      .then((r) => {
        if (active) setRows(r.filter((x) => x.publicationId === publicationId));
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId, publicationId]);
  async function perform(action: () => Promise<YunxiaoSync | null>) {
    setBusy(true);
    setError("");
    try {
      const row = await action();
      if (row)
        setRows((previous) => [
          row,
          ...previous.filter((r) => r.id !== row.id),
        ]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>云效状态同步</h3>
      <p className="muted">
        使用项目设置中“首次发布成功后”的状态映射。先核对工作项，再确认更新；同步结果单独保存。
      </p>
      <label>
        内部工作项 ID（非显示编号）
        <input
          aria-label="云效工作项 ID"
          value={itemId}
          disabled={busy}
          onChange={(e) => setItemId(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !itemId.trim()}
        onClick={() =>
          void perform(() =>
            desktop().yunxiaoSync.prepare(
              projectId,
              publicationId,
              itemId.trim(),
            ),
          )
        }
      >
        读取并准备同步
      </button>
      {rows.map((row) => (
        <div key={row.id}>
          <p>
            <strong>{row.item.title}</strong> · {row.item.id}
            <br />
            项目：{row.projectId}
            <br />
            {row.item.status.name} → {row.target.name}
          </p>
          <p role="status">
            {row.message ?? "待确认同步"}
            {row.readback && ` · 读回：${row.readback.status.name}`}
          </p>
          <button
            disabled={
              busy || row.state === "conflict" || row.state === "writing"
            }
            onClick={() =>
              void perform(() =>
                desktop().yunxiaoSync.execute(projectId, row.id, row.digest),
              )
            }
          >
            {row.writeAttempted || row.state === "synced"
              ? "读回核对（不重发）"
              : "确认同步状态"}
          </button>
          <details>
            <summary>同步收据</summary>
            <p>记录：{row.id}</p>
            <ul>
              {row.events.map((event, i) => (
                <li key={i}>
                  {event.at} · {event.stage}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
