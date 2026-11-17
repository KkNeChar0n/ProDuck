import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export interface CredentialStore {
  set(reference: string, value: string): Promise<void>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}
export class MacKeychain implements CredentialStore {
  constructor(private executable: string) {}
  private request(
    operation: string,
    reference: string,
    value?: string,
  ): Promise<{ value?: string | null }> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        reference,
      )
    )
      return Promise.reject(new Error("凭证引用无效"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("钥匙串访问超时，请检查系统授权提示"));
      }, 30000);
      const finish = (error?: Error, result?: { value?: string | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result ?? {});
      };
      child.on("error", () =>
        finish(new Error("凭证服务无法启动，请检查应用安装")),
      );
      child.stdin.on("error", () => finish(new Error("凭证服务通信失败")));
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 65536) {
          child.kill();
          finish(new Error("凭证服务响应异常"));
        }
      });
      child.stderr.resume();
      child.on("close", (code) => {
        if (code !== 0) {
          finish(
            new Error(
              "无法访问 macOS 钥匙串，请确认钥匙串已解锁并允许 Produck 访问",
            ),
          );
          return;
        }
        try {
          finish(undefined, JSON.parse(output));
        } catch {
          finish(new Error("凭证服务返回无效结果"));
        }
      });
      child.stdin.end(
        JSON.stringify({
          operation,
          reference,
          ...(value === undefined ? {} : { value }),
        }),
      );
    });
  }
  async set(reference: string, value: string) {
    if (!value || Buffer.byteLength(value) > 16384)
      throw new Error("凭证不能为空或超过长度限制");
    await this.request("set", reference, value);
  }
  async get(reference: string) {
    return (await this.request("get", reference)).value ?? null;
  }
  async delete(reference: string) {
    await this.request("delete", reference);
  }
}
export function newCredentialReference() {
  return randomUUID();
}
/** Logs must be structured and use explicit redaction rather than dumping request bodies. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /token|secret|password|authorization|api.?key/i.test(key)
          ? "[REDACTED]"
          : redact(entry),
      ]),
    );
  return value;
}
