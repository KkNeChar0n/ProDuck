// Test-only in-memory Feishu transport. Never forwards platform requests.
const assert = require("node:assert/strict");
module.exports = function fixture() {
  let sequence = 0;
  const nodes = [
    {
      node_token: "fixture",
      obj_token: "parentdoc",
      space_id: "space1",
      obj_type: "docx",
      title: "平台连接测试迭代",
    },
  ];
  const blocks = new Map([["parentdoc", []]]),
    media = new Map();
  const json = (data) => Response.json({ code: 0, data });
  return {
    nodes,
    fetch: async (input, init = {}) => {
      const url = new URL(input),
        method = init.method ?? "GET",
        path = url.pathname;
      assert.equal(url.origin, "https://open.feishu.cn");
      if (path.endsWith("tenant_access_token/internal")) {
        assert.equal(
          JSON.parse(init.body).app_secret,
          "synthetic-platform-secret",
        );
        return Response.json({
          code: 0,
          tenant_access_token: "synthetic-tenant",
        });
      }
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer synthetic-tenant",
      );
      if (path.endsWith("/spaces/get_node"))
        return json({
          node: nodes.find(
            (n) => n.node_token === url.searchParams.get("token"),
          ),
        });
      if (path.endsWith("/spaces/space1/nodes")) {
        if (method === "GET")
          return json({ items: nodes.slice(1), has_more: false });
        const body = JSON.parse(init.body),
          node = {
            ...body,
            node_token: `node${++sequence}`,
            obj_token: `doc${sequence}`,
            space_id: "space1",
          };
        nodes.push(node);
        blocks.set(node.obj_token, []);
        return json({ node });
      }
      const children = path.match(
        /\/documents\/([^/]+)\/blocks\/[^/]+\/children$/,
      );
      if (children) {
        if (method === "GET")
          return json({
            items: structuredClone(blocks.get(children[1])),
            has_more: false,
          });
        const created = JSON.parse(init.body).children.map((b) => ({
          ...b,
          block_id: `block${++sequence}`,
        }));
        blocks.get(children[1]).push(...created);
        return json({ children: structuredClone(created) });
      }
      if (path.endsWith("/medias/upload_all")) {
        const form = init.body,
          file = form.get("file"),
          token = `media${++sequence}`;
        assert.equal(Number(form.get("size")), file.size);
        media.set(token, await file.arrayBuffer());
        return json({ file_token: token });
      }
      const download = path.match(/\/medias\/([^/]+)\/download$/);
      if (download) {
        assert(media.has(download[1]));
        return new Response(media.get(download[1]));
      }
      const patch = path.match(/\/documents\/([^/]+)\/blocks\/([^/]+)$/);
      if (patch && method === "PATCH") {
        const body = JSON.parse(init.body),
          block = blocks.get(patch[1]).find((b) => b.block_id === patch[2]);
        if (body.replace_file) block.file = body.replace_file;
        if (body.replace_image) block.image = body.replace_image;
        return json({ block });
      }
      throw new Error(`Unexpected test API: ${method} ${path}`);
    },
  };
};
