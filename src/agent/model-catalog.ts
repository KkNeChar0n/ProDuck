import type { ModelCatalogInput } from "../contracts/models.js";
import { validateEndpoint } from "./model-client.js";

export async function listModels(
  input: ModelCatalogInput & { token: string },
  transport: typeof fetch = fetch,
): Promise<string[]> {
  const endpoint = validateEndpoint(input.endpoint);
  const headers: Record<string, string> =
    input.provider === "anthropic"
      ? { "x-api-key": input.token, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${input.token}` };
  const ids = new Set<string>();
  let after = "";
  const signal = AbortSignal.timeout(20000);
  for (let page = 0; page < 20; page++) {
    let response: Response;
    try {
      response = await transport(
        `${endpoint}/models${input.provider === "anthropic" ? `?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}` : ""}`,
        { headers, redirect: "error", signal },
      );
    } catch {
      throw new Error(
        "读取模型列表失败：请检查服务地址和网络；也可以手动填写模型 ID。",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new Error("模型列表鉴权失败，请检查 API token 和访问权限");
    if (!response.ok)
      throw new Error(
        `服务未能提供模型列表（HTTP ${response.status}），可以手动填写模型 ID。`,
      );
    let body: {
      data?: { id?: unknown }[];
      has_more?: boolean;
      last_id?: unknown;
    };
    try {
      body = await response.json();
    } catch {
      throw new Error("模型列表格式无效，可以手动填写模型 ID。");
    }
    if (!body || !Array.isArray(body.data))
      throw new Error("模型列表格式无效，可以手动填写模型 ID。");
    for (const item of body.data)
      if (
        item &&
        typeof item.id === "string" &&
        item.id.trim() &&
        item.id.length <= 200
      )
        ids.add(item.id);
    if (input.provider !== "anthropic" || !body.has_more)
      return [...ids].sort();
    if (
      typeof body.last_id !== "string" ||
      !body.last_id ||
      body.last_id === after
    )
      throw new Error("模型列表分页无效，可以手动填写模型 ID。");
    after = body.last_id;
  }
  throw new Error("模型列表过长，请手动填写模型 ID。");
}
