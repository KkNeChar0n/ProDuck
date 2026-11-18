import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PublicationWorkflow } from "../src/workflows/publication.js";
import type { PublicationReviews } from "../src/workflows/publication-review.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { openProjectDatabase } from "../src/projects/storage.js";
import {
  FeishuClient,
  type FeishuBlock,
  type FeishuPort,
  type WikiNode,
} from "../src/integrations/feishu.js";
import type { PublicationReview } from "../src/contracts/publication.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "produck-publish-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root);
  const files = [
    Buffer.from("# 客户管理\n需求正文"),
    Buffer.from("<html>prototype</html>"),
    Buffer.from("synthetic-image"),
  ];
  mkdirSync(join(p.workspace, "documents/review"));
  const review: PublicationReview = {
    id: "review1",
    draftId: "draft1",
    versionId: "v1",
    digest: "digest",
    createdAt: "now",
    status: "approved",
    parent: {
      appId: "app",
      url: "https://example.feishu.cn/wiki/parent",
      title: "迭代",
      targetId: "parent",
    },
    files: files.map((bytes, index) => {
      const path = `documents/review/${index}`;
      writeFileSync(join(p.workspace, path), bytes);
      return {
        path,
        label: `素材 ${index}`,
        bytes: bytes.length,
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  };
  const parent: WikiNode = {
    node_token: "parent",
    obj_token: "parentdoc",
    space_id: "space",
    title: "迭代",
    obj_type: "docx",
  };
  const nodes = [parent],
    blocks = new Map<string, FeishuBlock[]>([["parentdoc", []]]),
    media = new Map<string, Uint8Array>();
  let seq = 0,
    creates = 0,
    writes = 0,
    uploads = 0,
    loseCreate = false,
    loseUpload = false,
    corruptRead = false,
    refuseWrite = false,
    loseAppend = false,
    loseBind = false,
    failReadback = false,
    hideChildren = false;
  const client: FeishuPort = {
    node: async (token) =>
      structuredClone(nodes.find((n) => n.node_token === token)!),
    children: async () => (hideChildren ? [] : structuredClone(nodes.slice(1))),
    createNode: async (space, parentToken, title) => {
      writes++;
      creates++;
      const node = {
        node_token: `node${++seq}`,
        obj_token: `doc${seq}`,
        space_id: space,
        parent_node_token: parentToken,
        title,
        obj_type: "docx",
      };
      nodes.push(node);
      blocks.set(node.obj_token, []);
      if (loseCreate) {
        loseCreate = false;
        throw new Error("创建响应丢失");
      }
      return structuredClone(node);
    },
    blocks: async (doc) => {
      const result = structuredClone(blocks.get(doc)!);
      if (corruptRead && doc !== "parentdoc" && result[0])
        result[0].text.elements[0].text_run.content = "changed";
      return result;
    },
    append: async (doc, children) => {
      writes++;
      if (refuseWrite) throw new Error("断网");
      const result = children.map((b) => ({
        ...structuredClone(b),
        block_id: `block${++seq}`,
      }));
      blocks.get(doc)!.push(...result);
      if (loseAppend && doc !== "parentdoc") {
        loseAppend = false;
        throw new Error("正文响应丢失");
      }
      return structuredClone(result);
    },
    upload: async (_block, _name, bytes) => {
      writes++;
      uploads++;
      const token = `media${++seq}`;
      media.set(token, bytes);
      if (loseUpload) {
        loseUpload = false;
        throw new Error("上传响应丢失");
      }
      return token;
    },
    bind: async (doc, block, token, image) => {
      writes++;
      const value = blocks.get(doc)!.find((b) => b.block_id === block)!;
      value[image ? "image" : "file"] = { token };
      if (loseBind) {
        loseBind = false;
        throw new Error("绑定响应丢失");
      }
    },
    download: async (token) => {
      if (failReadback) throw new Error("读回断网");
      return media.get(token)!;
    },
  };
  const reviews = {
    verify: (_id: string, reviewId: string) => {
      assert.equal(reviewId, review.id);
      return review;
    },
  } as unknown as PublicationReviews;
  const workflow = () =>
    new PublicationWorkflow(projects, reviews, async () => client);
  return {
    db,
    p,
    review,
    workflow,
    blocks,
    media,
    client,
    interruptAppend: () => {
      loseAppend = true;
    },
    interruptBind: () => {
      loseBind = true;
    },
    failReadback: (value: boolean) => {
      failReadback = value;
    },
    hideChildren: (value: boolean) => {
      hideChildren = value;
    },
    counts: () => ({ creates, writes, uploads }),
    loseCreate: () => {
      loseCreate = true;
    },
    loseUpload: () => {
      loseUpload = true;
    },
    corrupt: () => {
      corruptRead = true;
    },
    refuse: () => {
      refuseWrite = true;
    },
  };
}
test("first publication validates assets and readback; repeated publish performs no additional writes", async () => {
  const f = fixture(),
    publisher = f.workflow();
  const result = await publisher.publish(
    f.p.id,
    "review1",
    "digest",
    "客户管理",
  );
  assert.equal(result.state, "published", result.message);
  assert(result.documentUrl);
  assert(result.steps.every((s) => s.state === "done"));
  const before = f.counts();
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "published",
  );
  assert.deepEqual(f.counts(), before);
  f.db.close();
});
test("lost create response recovers exact child after restart without duplicate creation", async () => {
  const f = fixture();
  f.loseCreate();
  const first = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(first.state, "needs-check");
  assert.equal(f.counts().creates, 1);
  const second = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(second.state, "published", second.message);
  assert.equal(f.counts().creates, 1);
  f.db.close();
});
test("unknown media upload cannot be automatically repeated or reported successful", async () => {
  const f = fixture();
  f.loseUpload();
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "needs-check",
  );
  const before = f.counts();
  const next = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(next.state, "needs-check");
  assert.match(next.message!, /不确定/);
  assert.deepEqual(f.counts(), before);
  f.db.close();
});
test("different common prototype, failed writes and modified readback cannot falsely finish", async () => {
  const f = fixture();
  f.blocks.get("parentdoc")!.push({
    block_id: "old",
    block_type: 2,
    text: {
      elements: [{ text_run: { content: "Produck 共用原型 SHA256:other" } }],
    },
  });
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "partial",
  );
  assert.equal(f.counts().writes, 0);
  f.db.close();
  const g = fixture();
  g.refuse();
  assert.equal(
    (await g.workflow().publish(g.p.id, "review1", "digest", "客户管理")).state,
    "needs-check",
  );
  g.db.close();
  const h = fixture();
  h.corrupt();
  assert.equal(
    (await h.workflow().publish(h.p.id, "review1", "digest", "客户管理")).state,
    "partial",
  );
  h.db.close();
});
test("publication rejects missing material approval and mismatched review digest before network writes", async () => {
  const f = fixture();
  await assert.rejects(
    f.workflow().publish(f.p.id, "review1", "wrong", "标题"),
    /确认/,
  );
  f.review.status = "prepared";
  await assert.rejects(
    f.workflow().publish(f.p.id, "review1", "digest", "标题"),
    /确认/,
  );
  assert.equal(f.counts().writes, 0);
  f.db.close();
});
test("Feishu adapter uses official block/media contracts, bounded redirects and sanitized errors", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new FeishuClient("synthetic", async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("upload_all")) {
      const form = init!.body as FormData;
      assert.equal(form.get("parent_type"), "docx_file");
      assert.equal(form.get("parent_node"), "block1");
      return Response.json({ code: 0, data: { file_token: "media1" } });
    }
    if (String(url).includes("children?client_token"))
      return Response.json({
        code: 0,
        data: { children: [{ block_id: "block1", block_type: 23, file: {} }] },
      });
    if (String(url).endsWith("/download")) return new Response("data");
    return Response.json({ code: 0, data: {} });
  });
  await client.append("doc1", [{ block_type: 23, file: {} }], "request1");
  assert.equal(
    await client.upload("block1", "prototype.html", Buffer.from("data"), false),
    "media1",
  );
  await client.bind("doc1", "block1", "media1", false, "request2");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    replace_file: { token: "media1" },
  });
  assert.equal(Buffer.from(await client.download("media1")).toString(), "data");
  const failed = new FeishuClient("private", async () =>
    Response.json({ code: 999, msg: "private" }),
  );
  await assert.rejects(
    failed.blocks("doc1"),
    (e) => e instanceof Error && !e.message.includes("private"),
  );
});

test("body append response loss reconciles exact existing blocks without duplication", async () => {
  const f = fixture();
  f.interruptAppend();
  const first = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(first.state, "needs-check");
  const bodyCount = [...f.blocks.values()]
    .flat()
    .filter((b) =>
      b.text?.elements?.some(
        (e: any) => e.text_run?.content === "# 客户管理\n需求正文",
      ),
    ).length;
  assert.equal(bodyCount, 1);
  const next = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(next.state, "published", next.message);
  assert.equal(f.counts().creates, 1);
  assert.equal(
    [...f.blocks.values()]
      .flat()
      .filter((b) =>
        b.text?.elements?.some(
          (e: any) => e.text_run?.content === "# 客户管理\n需求正文",
        ),
      ).length,
    1,
  );
  f.db.close();
});
test("attachment binding response loss recovers from remote token and never uploads twice", async () => {
  const f = fixture();
  f.interruptBind();
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "needs-check",
  );
  assert.equal(f.counts().uploads, 1);
  const next = await f
    .workflow()
    .publish(f.p.id, "review1", "digest", "客户管理");
  assert.equal(next.state, "published", next.message);
  assert.equal(f.counts().uploads, 2); // one prototype and one screenshot
  assert.equal(f.counts().creates, 1);
  f.db.close();
});
test("unresolved create timeout never resends; later visibility allows reconciliation", async () => {
  const f = fixture();
  f.loseCreate();
  await f.workflow().publish(f.p.id, "review1", "digest", "客户管理");
  f.hideChildren(true);
  const before = f.counts();
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "needs-check",
  );
  assert.deepEqual(f.counts(), before);
  f.hideChildren(false);
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "published",
  );
  assert.equal(f.counts().creates, 1);
  f.db.close();
});
test("readback failure preserves receipts and restart only continues missing stages", async () => {
  const f = fixture();
  f.failReadback(true);
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "partial",
  );
  const path = join(f.p.workspace, "workflows/publications.json"),
    records = JSON.parse(readFileSync(path, "utf8"));
  records[0].state = "running";
  writeFileSync(path, JSON.stringify(records));
  assert.equal(f.workflow().list(f.p.id)[0].state, "needs-check");
  f.failReadback(false);
  assert.equal(
    (await f.workflow().publish(f.p.id, "review1", "digest", "客户管理")).state,
    "published",
  );
  assert.equal(f.counts().uploads, 2);
  assert.equal(f.counts().creates, 1);
  f.db.close();
});
