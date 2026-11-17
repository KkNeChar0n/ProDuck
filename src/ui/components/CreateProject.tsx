import { useEffect, useRef, useState } from "react";
import type { WorkspaceState } from "../../contracts/projects";
import { desktop, errorText } from "../bridge";
export function CreateProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (state: WorkspaceState) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-head">
        <h2>创建项目</h2>
        <button
          aria-label="关闭弹窗"
          className="icon"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">选择文件夹后，Produck 会在其中创建独立工作空间。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await desktop().projects.create(name);
            if (result) onCreated(result);
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-field">
          <label htmlFor="project-name">项目名称</label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
            disabled={busy}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? "等待选择文件夹…" : "选择文件夹并创建"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
