import { utilityProcess } from "electron";
import { fileURLToPath } from "node:url";
import type { ModelService } from "../agent/model-service.js";
import type { Planner } from "../agent/runner.js";
/** Model/network work runs in a disposable utility process; host retains all tool permissions. */
export function createPlanner(models: ModelService): Planner {
  return async (id, prompt, signal) => {
    const { signal: _signal, ...request } = await models.request(
      id,
      prompt,
      signal,
    );
    if (signal.aborted) throw new Error("任务已取消");
    return new Promise<string>((resolve, reject) => {
      const child = utilityProcess.fork(
        fileURLToPath(new URL("../agent/planner-worker.js", import.meta.url)),
        [],
        { serviceName: "Produck Agent Planner", stdio: "pipe" },
      );
      let settled = false;
      const done = (error?: Error, text?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        child.kill();
        error ? reject(error) : resolve(text!);
      };
      const abort = () => done(new Error("任务已取消"));
      const timer = setTimeout(() => done(new Error("模型规划超时")), 125000);
      signal.addEventListener("abort", abort, { once: true });
      child.once("spawn", () => {
        if (signal.aborted) abort();
        else child.postMessage(request);
      });
      child.once("exit", () => done(new Error("模型执行进程提前退出")));
      child.once("message", (value: unknown) => {
        if (!value || typeof value !== "object")
          return done(new Error("模型执行进程返回无效消息"));
        if ("error" in value && typeof value.error === "string")
          return done(new Error(value.error));
        if (
          "text" in value &&
          typeof value.text === "string" &&
          value.text.length <= 20000
        )
          return done(undefined, value.text);
        done(new Error("模型规划响应无效"));
      });
    });
  };
}
