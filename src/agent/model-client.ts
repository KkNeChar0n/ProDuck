import type { ModelProvider } from "../contracts/models.js";
export interface ModelRequest {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  token: string;
  prompt: string;
  signal?: AbortSignal;
  maxTokens?: number;
}
export function validateEndpoint(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("模型地址不能包含凭证、查询参数或锚点");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("模型地址需要 HTTPS；本地服务可使用 HTTP");
  return url.href.replace(/\/$/, "");
}
function requestBody(input: ModelRequest, stream: boolean) {
  return input.provider === "anthropic"
    ? {
        model: input.model,
        max_tokens: input.maxTokens ?? 1024,
        stream,
        messages: [{ role: "user", content: input.prompt }],
      }
    : {
        model: input.model,
        stream,
        messages: [{ role: "user", content: input.prompt }],
      };
}
async function send(
  input: ModelRequest,
  stream: boolean,
  transport: typeof fetch,
): Promise<Response> {
  const endpoint = validateEndpoint(input.endpoint);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.provider === "anthropic") {
    headers["x-api-key"] = input.token;
    headers["anthropic-version"] = "2023-06-01";
  } else headers.Authorization = `Bearer ${input.token}`;
  let response: Response;
  try {
    response = await transport(
      `${endpoint}/${input.provider === "anthropic" ? "messages" : "chat/completions"}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody(input, stream)),
        redirect: "error",
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000),
      },
    );
  } catch (error) {
    if (input.signal?.aborted) throw new Error("已取消");
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";
    const safeCode =
      /^(?:E[A-Z_]+|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/.test(
        code,
      )
        ? `（${code}）`
        : "";
    if (cause instanceof Error && cause.message === "unexpected redirect")
      throw new Error("模型接口发生重定向，请将 Base URL 设置为最终 API 地址");
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "模型请求超时，请重试"
        : `无法连接模型服务${safeCode}，请检查地址和网络`,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new Error("模型鉴权失败，请检查 API token 和访问权限");
  if (response.status === 404)
    throw new Error("模型或接口不存在，请检查 Base URL 和模型名称");
  if (response.status === 429)
    throw new Error("模型请求受限，请检查额度或稍后重试");
  if (!response.ok)
    throw new Error(`模型服务请求失败（HTTP ${response.status}）`);
  return response;
}
export async function testModel(
  input: ModelRequest,
  transport: typeof fetch = fetch,
): Promise<void> {
  const response = await send(
    { ...input, prompt: "Reply with OK." },
    false,
    transport,
  );
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error("模型服务未返回有效 JSON");
  }
  const valid =
    input.provider === "anthropic"
      ? Array.isArray(result.content) &&
        result.content.some(
          (b: any) => b.type === "text" && typeof b.text === "string",
        )
      : typeof result.choices?.[0]?.message?.content === "string";
  if (!valid) throw new Error("模型响应格式不兼容，请检查供应商类型");
}
/** Incrementally parse SSE across arbitrary network chunk boundaries. */
export async function* streamModel(
  input: ModelRequest,
  transport: typeof fetch = fetch,
): AsyncGenerator<string> {
  const response = await send(input, true, transport);
  if (!response.body) throw new Error("模型服务没有返回内容");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    finished = false;
  try {
    while (!finished) {
      let packet: ReadableStreamReadResult<Uint8Array>;
      try {
        packet = await reader.read();
      } catch {
        throw new Error(
          input.signal?.aborted ? "已取消" : "模型连接中断，请重试",
        );
      }
      buffer = (
        buffer +
        decoder.decode(packet.value ?? new Uint8Array(), {
          stream: !packet.done,
        })
      ).replace(/\r\n/g, "\n");
      if (buffer.length > 1024 * 1024) throw new Error("模型事件超过大小限制");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        let value: any;
        try {
          value = JSON.parse(data);
        } catch {
          throw new Error("模型流式响应格式无效");
        }
        if (value.error || value.type === "error")
          throw new Error("模型在生成过程中返回错误");
        if (value.type === "message_stop") {
          finished = true;
          break;
        }
        const text =
          input.provider === "anthropic"
            ? value.type === "content_block_delta"
              ? value.delta?.text
              : undefined
            : value.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      }
      if (packet.done) {
        if (!finished) throw new Error("模型流提前中断，未收到完成标记");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
