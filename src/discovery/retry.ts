import { setTimeout } from "node:timers/promises";

/** Retry only observation/model work, never dispatched browser actions. */
export async function retryDiscovery<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  notify: (attempt: number, error: string) => void,
  delayMs = 1000,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await operation();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : "未知错误";
      if (
        /鉴权|权限|401|403|token|未配置|上下文|超出预算|浏览器已关闭|Chrome.*关闭/i.test(
          message,
        )
      )
        throw error;
      if (attempt === 3) throw new Error(`自动重试 3 次后仍失败：${message}`);
      notify(attempt + 1, message);
      await setTimeout(delayMs * 2 ** attempt, undefined, { signal });
    }
  }
}
