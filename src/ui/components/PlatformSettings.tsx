import { useEffect, useState } from "react";
import type { Platform, PlatformProfile } from "../../contracts/platforms";
import { desktop, errorText } from "../bridge";
export function PlatformSettings({
  projectId,
  provider,
}: {
  projectId: string;
  provider: Platform;
}) {
  const [profile, setProfile] = useState<PlatformProfile | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    desktop()
      .platforms.profile(projectId, provider)
      .then((value) => {
        if (active) {
          setProfile(value);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [projectId, provider]);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(form),
      value = (key: string) => String(data.get(key) ?? "").trim();
    try {
      const next = await desktop().platforms.save(projectId, {
        provider,
        url: value("url"),
        secret: value("secret") || undefined,
        ...(provider === "feishu"
          ? { appId: value("appId") }
          : {
              organizationId: value("organizationId"),
              projectId: value("projectId"),
              statusMapping: {
                published: value("published"),
                merged: value("merged"),
              },
            }),
      });
      setProfile(next);
      (form.elements.namedItem("secret") as HTMLInputElement).value = "";
      setNotice("配置已保存，凭证已存入钥匙串。请测试已保存配置。");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await desktop().platforms.test(projectId, provider);
      setNotice(
        provider === "feishu" && !profile?.url
          ? "飞书应用鉴权成功。请在版本设置填写迭代地址并测试节点读取权限。"
          : `读取成功：${result.title}（${result.targetId}）。已验证读取权限，尚未验证发布权限或状态映射。`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>
        {provider === "feishu"
          ? "飞书应用凭证（项目共享）"
          : "云效中心版（项目共享）"}
      </h3>
      {loaded && (
        <form
          className="connection-form"
          onChange={() => setNotice("")}
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, width: "100%" }}
          >
            {provider === "yunxiao" && (
              <label>
                项目地址
                <input
                  name="url"
                  type="url"
                  required
                  defaultValue={profile?.url ?? ""}
                  placeholder="https://devops.aliyun.com/…"
                />
              </label>
            )}
            {provider === "feishu" ? (
              <label>
                App ID
                <input
                  name="appId"
                  required
                  defaultValue={profile?.appId ?? ""}
                />
              </label>
            ) : (
              <>
                <label>
                  组织 ID
                  <input
                    name="organizationId"
                    required
                    defaultValue={profile?.organizationId ?? ""}
                  />
                </label>
                <label>
                  项目 ID
                  <input
                    name="projectId"
                    required
                    defaultValue={profile?.projectId ?? ""}
                  />
                </label>
              </>
            )}
            <label>
              {provider === "feishu" ? "App Secret" : "个人访问令牌（PAT）"}
              <input
                name="secret"
                type="password"
                autoComplete="new-password"
                required={!profile?.hasCredential}
                placeholder={
                  profile?.hasCredential
                    ? "已保存；留空保留，更换凭证时填写"
                    : "仅保存在 macOS 钥匙串"
                }
              />
            </label>
            {provider === "yunxiao" && (
              <>
                <p className="muted">
                  当前使用中心版 PAT，不支持旧版 AccessKey 或 Region
                  版。以下状态 ID 可留空；不会自动推断“已完成”。
                </p>
                <label>
                  首次发布成功后 → 状态 ID
                  <input
                    name="published"
                    defaultValue={profile?.statusMapping?.published ?? ""}
                    placeholder="留空则不同步"
                  />
                </label>
                <label>
                  差异合并成功后 → 状态 ID
                  <input
                    name="merged"
                    defaultValue={profile?.statusMapping?.merged ?? ""}
                    placeholder="留空则不同步"
                  />
                </label>
              </>
            )}
            <button type="submit">保存连接</button>{" "}
            <button
              type="button"
              disabled={!profile?.hasCredential}
              onClick={() => void test()}
            >
              测试已保存连接
            </button>
          </fieldset>
        </form>
      )}
      {provider === "feishu" && (
        <p className="muted">
          应用凭证由项目共享。迭代父节点地址请在版本设置填写；测试不会创建文档。
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
