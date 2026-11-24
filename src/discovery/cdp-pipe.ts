import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
/** Private pipe transport; no debugging port, profile copying or model-supplied code. */
export class CdpPipe {
  private child: ChildProcess;
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onEvent: (message: any) => void = () => {};
  constructor(binary: string, args: string[]) {
    this.child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    (this.child.stdio[4] as Readable)
      .setEncoding("utf8")
      .on("data", (data: string) => {
        this.buffer += data;
        if (this.buffer.length > 20_000_000) {
          this.close();
          return;
        }
        let end: number;
        while ((end = this.buffer.indexOf("\0")) >= 0) {
          const raw = this.buffer.slice(0, end);
          this.buffer = this.buffer.slice(end + 1);
          if (!raw) continue;
          try {
            const message = JSON.parse(raw);
            const pending = this.pending.get(message.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(message.id);
              if (message.error)
                pending.reject(
                  new Error(`Chrome 操作失败：${message.error.message}`),
                );
              else pending.resolve(message.result);
            } else this.onEvent(message);
          } catch {
            /* Chrome protocol messages only; malformed input cannot execute. */
          }
        }
      });
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => this.fail());
    (this.child.stdio[3] as Writable).on("error", () => this.fail());
  }
  private fail() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Chrome 已关闭，请重新打开浏览器后继续"));
    }
    this.pending.clear();
  }
  get alive() {
    return !this.closed;
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Chrome 已关闭"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Chrome 响应超时，请检查浏览器后继续"));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      (this.child.stdio[3] as Writable).write(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }) + "\0",
      );
    });
  }
  async shutdown() {
    if (this.closed) return;
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.close();
        resolve();
      }, 5000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await this.send("Browser.close").catch(() => {});
    await exited;
  }
  close() {
    this.child.kill("SIGTERM");
    this.fail();
  }
}
