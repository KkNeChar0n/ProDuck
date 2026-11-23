import { useEffect, useState } from "react";
import type { ProductRelease } from "../../contracts/projects";
import type { PrototypeVersion } from "../../contracts/workbench";
import { desktop, errorText } from "../bridge";
export function ReleaseSettings({
  release,
  releases,
  onUpdated,
}: {
  release: ProductRelease;
  releases: ProductRelease[];
  onUpdated: () => void;
}) {
  const [name, setName] = useState(release.name),
    [url, setUrl] = useState(release.feishuUrl),
    [source, setSource] = useState(""),
    [artifacts, setArtifacts] = useState<PrototypeVersion[]>([]),
    [artifact, setArtifact] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setArtifacts([]);
    setArtifact("");
    if (source)
      void desktop()
        .workbench.versions(source)
        .then((rows) => {
          if (active) {
            setArtifacts(rows);
            setArtifact(rows[0]?.id ?? "");
          }
        })
        .catch((e) => {
          if (active) setMessage(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [source]);
  async function perform(action: () => Promise<string>) {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await action());
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="paper release-settings">
      <h2>{release.name} · 版本设置</h2>
      <p className="muted">
        原型、文档、审批与交付记录归属于此版本。模型、工作空间与平台凭证沿用项目配置。
      </p>
      <form
        className="connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            await desktop().releases.update(release.id, name, url);
            onUpdated();
            return "版本设置已保存";
          });
        }}
      >
        <label>
          版本名称
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          飞书迭代地址（当前版本）
          <input
            aria-label="飞书迭代父节点地址"
            type="url"
            value={url}
            placeholder="https://团队.feishu.cn/wiki/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button disabled={busy}>保存版本设置</button>
        <button
          type="button"
          disabled={busy || !release.feishuUrl}
          onClick={() =>
            void perform(async () => {
              const result = await desktop().platforms.test(
                release.id,
                "feishu",
              );
              return `读取成功：${result.title}（${result.targetId}）。尚未验证发布权限。`;
            })
          }
        >
          测试已保存迭代地址
        </button>
      </form>
      <h3>从旧版本复制原型</h3>
      <p className="muted">
        复制为新的候选原型，需重新检查并通过；旧版原型与发布记录保留。
      </p>
      <div className="release-copy">
        <label>
          来源版本
          <select
            aria-label="来源产品版本"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={busy}
          >
            <option value="">选择来源版本</option>
            {releases
              .filter((r) => r.id !== release.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          来源原型
          <select
            aria-label="来源原型"
            value={artifact}
            onChange={(e) => setArtifact(e.target.value)}
            disabled={busy}
          >
            <option value="">选择原型</option>
            {artifacts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.createdAt} · {a.approved ? "已通过" : "候选"} ·{" "}
                {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !source || !artifact}
          onClick={() =>
            void perform(async () => {
              await desktop().releases.copyPrototype(
                release.id,
                source,
                artifact,
              );
              return "已复制为未批准候选，请到工作台查看";
            })
          }
        >
          复制到当前版本
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
