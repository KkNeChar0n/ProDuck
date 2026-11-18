export interface WikiNode {
  node_token: string;
  obj_token: string;
  space_id: string;
  parent_node_token?: string;
  title: string;
  obj_type: string;
}
export interface FeishuBlock {
  block_id?: string;
  block_type: number;
  [key: string]: any;
}
const segment = (value: string) => {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error("飞书标识无效");
  return value;
};
export const textBlock = (text: string, link?: string): FeishuBlock => ({
  block_type: 2,
  text: {
    elements: [
      {
        text_run: {
          content: text,
          ...(link ? { text_element_style: { link: { url: link } } } : {}),
        },
      },
    ],
  },
});
export const blockText = (block: FeishuBlock) =>
  (block.text?.elements ?? [])
    .map((e: any) => e.text_run?.content ?? "")
    .join("");
export interface FeishuPort {
  revision?(document: string): Promise<number>;
  download(token: string): Promise<Uint8Array>;
  node(token: string): Promise<WikiNode>;
  children(space: string, parent: string): Promise<WikiNode[]>;
  createNode(space: string, parent: string, title: string): Promise<WikiNode>;
  blocks(document: string): Promise<FeishuBlock[]>;
  append(
    document: string,
    children: FeishuBlock[],
    requestId: string,
  ): Promise<FeishuBlock[]>;
  upload(
    block: string,
    name: string,
    bytes: Uint8Array,
    image: boolean,
  ): Promise<string>;
  bind(
    document: string,
    block: string,
    token: string,
    image: boolean,
    requestId: string,
  ): Promise<void>;
}
export class FeishuClient implements FeishuPort {
  private lastWrite = 0;
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, method = "GET", body?: unknown) {
    if (method !== "GET") {
      const delay = 400 - (Date.now() - this.lastWrite);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      this.lastWrite = Date.now();
    }
    try {
      const form = body instanceof FormData;
      const response = await this.transport(
        `https://open.feishu.cn/open-apis/${path}`,
        {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(!form && body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          body:
            body === undefined ? undefined : form ? body : JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (value.code !== 0 || !value.data || typeof value.data !== "object")
        throw new Error();
      return value.data;
    } catch {
      throw new Error(
        method === "GET"
          ? "飞书读取失败，请检查网络和资源权限"
          : "飞书写入未确认，请先核对远端结果，勿重复创建",
      );
    }
  }
  async revision(document: string): Promise<number> {
    const data = await this.request(`docx/v1/documents/${segment(document)}`);
    const revision = data.document?.revision_id;
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error("无法读取有效文档版本，停止预检");
    return revision;
  }
  async download(token: string): Promise<Uint8Array> {
    try {
      const response = await this.transport(
        `https://open.feishu.cn/open-apis/drive/v1/medias/${segment(token)}/download`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20 * 1024 * 1024) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      throw new Error("素材下载读回失败，未确认发布成功");
    }
  }
  async node(token: string): Promise<WikiNode> {
    const value = (
      await this.request(`wiki/v2/spaces/get_node?token=${segment(token)}`)
    ).node;
    if (
      !value ||
      value.node_token !== token ||
      value.obj_type !== "docx" ||
      typeof value.title !== "string"
    )
      throw new Error("飞书节点不是有效的新版文档");
    segment(value.obj_token);
    segment(value.space_id);
    return value;
  }
  private async pages(path: string) {
    const items: any[] = [];
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      const data = await this.request(
        path + (cursor ? `&page_token=${encodeURIComponent(cursor)}` : ""),
      );
      if (!Array.isArray(data.items)) throw new Error("飞书分页结果无效");
      items.push(...data.items);
      if (!data.has_more) return items;
      if (!data.page_token || data.page_token === cursor)
        throw new Error("飞书分页游标无效");
      cursor = data.page_token;
    }
    throw new Error("飞书内容超过当前读取范围");
  }
  children(space: string, parent: string): Promise<WikiNode[]> {
    return this.pages(
      `wiki/v2/spaces/${segment(space)}/nodes?page_size=50&parent_node_token=${segment(parent)}`,
    );
  }
  async createNode(
    space: string,
    parent: string,
    title: string,
  ): Promise<WikiNode> {
    const value = (
      await this.request(`wiki/v2/spaces/${segment(space)}/nodes`, "POST", {
        obj_type: "docx",
        node_type: "origin",
        parent_node_token: segment(parent),
        title,
      })
    ).node;
    if (!value?.node_token || !value?.obj_token)
      throw new Error("飞书创建结果无效，需核对远端");
    return value;
  }
  blocks(document: string): Promise<FeishuBlock[]> {
    return this.pages(
      `docx/v1/documents/${segment(document)}/blocks/${segment(document)}/children?page_size=500`,
    );
  }
  async append(document: string, children: FeishuBlock[], requestId: string) {
    if (!children.length || children.length > 50)
      throw new Error("每批最多 50 个文档块");
    const value = await this.request(
      `docx/v1/documents/${segment(document)}/blocks/${segment(document)}/children?client_token=${segment(requestId)}`,
      "POST",
      { children, index: -1 },
    );
    if (
      !Array.isArray(value.children) ||
      value.children.length !== children.length ||
      value.children.some((b: any) => !b.block_id)
    )
      throw new Error("飞书块写入结果无效，需核对远端");
    return value.children as FeishuBlock[];
  }
  async upload(block: string, name: string, bytes: Uint8Array, image: boolean) {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new Error("单个附件需在 20 MB 内");
    const data = new FormData();
    data.set("file_name", name);
    data.set("parent_type", image ? "docx_image" : "docx_file");
    data.set("parent_node", segment(block));
    data.set("size", String(bytes.length));
    data.set("file", new Blob([new Uint8Array(bytes)]), name);
    const result = await this.request(
      "drive/v1/medias/upload_all",
      "POST",
      data,
    );
    if (typeof result.file_token !== "string" || !result.file_token)
      throw new Error("飞书素材上传结果无效，需核对远端");
    return result.file_token as string;
  }
  async bind(
    document: string,
    block: string,
    token: string,
    image: boolean,
    requestId: string,
  ) {
    await this.request(
      `docx/v1/documents/${segment(document)}/blocks/${segment(block)}?client_token=${segment(requestId)}`,
      "PATCH",
      { [image ? "replace_image" : "replace_file"]: { token } },
    );
  }
}
