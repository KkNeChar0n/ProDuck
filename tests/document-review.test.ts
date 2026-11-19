import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import {
  DocumentReviews,
  sections,
  lineDiff,
} from "../src/workflows/document-review.js";
import {
  textBlock,
  type FeishuPort,
  type FeishuBlock,
} from "../src/integrations/feishu.js";
import type { PublicationWorkflow } from "../src/workflows/publication.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "produck-diff-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    b = projects.create("B", root);
  const blocks: FeishuBlock[] = [
    { ...textBlock("Produck 发布 run 正文 1"), block_id: "marker" },
    { ...textBlock("# 目标\n原目标\n## 验收\n可筛选"), block_id: "body" },
    { block_id: "image", block_type: 27, image: { token: "media" } },
    { ...textBlock("其他用户备注"), block_id: "manual" },
  ];
  let reads = 0;
  const client = {
    node: async () => ({
      node_token: "node",
      obj_token: "doc",
      space_id: "space",
      parent_node_token: "parent",
      title: "需求",
      obj_type: "docx",
    }),
    revision: async () => 10,
    blocks: async () => {
      reads++;
      return structuredClone(blocks);
    },
  } as unknown as FeishuPort;
  const publications = {
    list: (id: string) =>
      id === p.id
        ? [
            {
              id: "run",
              state: "published",
              parentUrl: "https://example.feishu.cn/wiki/parent",
              documentUrl: "https://example.feishu.cn/wiki/node",
            },
          ]
        : [],
  } as unknown as PublicationWorkflow;
  const service = () =>
    new DocumentReviews(
      projects,
      publications,
      {
        profile: () => ({
          provider: "feishu",
          url: "https://example.feishu.cn/wiki/parent",
          hasCredential: true,
        }),
      },
      async () => client,
    );
  return { db, p, b, blocks, client, service, reads: () => reads };
}
test("sections locate Markdown headings inside one block while protecting non-text and metadata", () => {
  const f = fixture(),
    result = sections(f.blocks);
  assert.deepEqual(
    result.map((s) => s.title),
    ["Produck 发布 run 正文 1", "目标", "验收", "页面截图", "正文"],
  );
  assert.equal(result[1].text, "# 目标\n原目标\n");
  assert.equal(result[2].text, "## 验收\n可筛选");
  assert.equal(result[0].editable, false);
  assert.equal(result[3].editable, false);
  assert.equal(result[1].spans[0].end, result[2].spans[0].start);
  assert.equal(result[1].fingerprint, result[2].fingerprint); // shared block: conservatively conflict together
  assert.notEqual(result[1].id, result[2].id);
  f.db.close();
});
test("reviews use live content, persist exact changes, and approval only reads without writing remote content", async () => {
  const f = fixture(),
    service = f.service(),
    snapshot = await service.fetch(f.p.id, "run"),
    target = snapshot.sections.find((s) => s.title === "验收")!;
  const before = structuredClone(f.blocks);
  const review = service.prepare(
    f.p.id,
    snapshot.id,
    target.id,
    "## 验收\n可筛选\n支持重置",
  );
  assert(
    review.diff.some(
      (line) => line.kind === "added" && line.text === "支持重置",
    ),
  );
  assert.equal(
    (await f.service().approve(f.p.id, review.id, review.digest)).state,
    "approved",
  );
  assert.equal(f.reads(), 2);
  assert.deepEqual(f.blocks, before);
  assert.equal(f.service().reviews(f.p.id).length, 1);
  await assert.rejects(service.fetch(f.b.id, "run"), /当前项目/);
  assert.throws(() => service.prepare(f.b.id, snapshot.id, target.id, "x"));
  f.db.close();
});
test("changed related block conflicts, unrelated user edits are preserved, wrong digest and readonly blocks reject", async () => {
  const f = fixture(),
    service = f.service(),
    snapshot = await service.fetch(f.p.id, "run"),
    target = snapshot.sections.find((s) => s.title === "验收")!;
  const review = service.prepare(
    f.p.id,
    snapshot.id,
    target.id,
    "## 验收\n新标准",
  );
  await assert.rejects(service.approve(f.p.id, review.id, "wrong"), /变化/);
  assert.throws(
    () =>
      service.prepare(f.p.id, snapshot.id, snapshot.sections[0].id, "erase"),
    /普通文字/,
  );
  f.blocks[3].text.elements[0].text_run.content = "用户新备注";
  assert.equal(
    (await service.approve(f.p.id, review.id, review.digest)).state,
    "approved",
  );
  f.blocks[1].text.elements[0].text_run.content =
    "# 目标\n人工新目标\n## 验收\n可筛选";
  const conflict = await service.approve(f.p.id, review.id, review.digest);
  assert.equal(conflict.state, "conflict");
  assert.equal(conflict.approvedAt, undefined);
  assert.equal(f.blocks[3].text.elements[0].text_run.content, "用户新备注");
  f.db.close();
});
test("line diff handles insertions, deletions and empty replacements without losing unchanged suffix", () => {
  assert.deepEqual(
    lineDiff("a\nb\nc", "a\nx\nc").map((x) => [x.kind, x.text]),
    [
      ["same", "a"],
      ["removed", "b"],
      ["added", "x"],
      ["same", "c"],
    ],
  );
  assert.deepEqual(lineDiff("a", ""), [
    { kind: "removed", text: "a" },
    { kind: "added", text: "" },
  ]);
});

test("merge preflight requires independent approval and preserves exact adjacent section bytes without any write", async () => {
  const f = fixture(),
    service = f.service(),
    snapshot = await service.fetch(f.p.id, "run"),
    target = snapshot.sections.find((s) => s.title === "目标")!;
  const review = service.prepare(
    f.p.id,
    snapshot.id,
    target.id,
    "# 目标\n新目标\n",
  );
  await assert.rejects(
    service.preflight(f.p.id, review.id, review.digest),
    /先批准/,
  );
  await service.approve(f.p.id, review.id, review.digest);
  const original = structuredClone(f.blocks),
    plan = await service.preflight(f.p.id, review.id, review.digest);
  assert.equal(plan.writeEnabled, false);
  assert.equal(plan.revision, 10);
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].after, "# 目标\n新目标\n## 验收\n可筛选");
  assert.deepEqual(f.blocks, original);
  f.blocks[1].text.elements[0].text_run.content =
    "# 目标\n人工修改\n## 验收\n可筛选";
  await assert.rejects(
    service.preflight(f.p.id, review.id, review.digest),
    /批准失效/,
  );
  assert.equal(service.reviews(f.p.id)[0].state, "conflict");
  f.db.close();
});
test("preflight rejects section boundary concatenation instead of silently modifying approved content", async () => {
  const f = fixture(),
    service = f.service(),
    snapshot = await service.fetch(f.p.id, "run"),
    target = snapshot.sections.find((s) => s.title === "目标")!;
  const review = service.prepare(
    f.p.id,
    snapshot.id,
    target.id,
    "# 目标\n缺少末尾换行",
  );
  await service.approve(f.p.id, review.id, review.digest);
  await assert.rejects(
    service.preflight(f.p.id, review.id, review.digest),
    /保留换行/,
  );
  f.db.close();
});

test("preflight detects a document revision change during the read window", async () => {
  const f = fixture(),
    service = f.service(),
    snapshot = await service.fetch(f.p.id, "run"),
    target = snapshot.sections.find((s) => s.title === "验收")!;
  const review = service.prepare(
    f.p.id,
    snapshot.id,
    target.id,
    "## 验收\n新标准",
  );
  await service.approve(f.p.id, review.id, review.digest);
  let revision = 10;
  f.client.revision = async () => revision++;
  await assert.rejects(
    service.preflight(f.p.id, review.id, review.digest),
    /预检期间文档发生变化/,
  );
  f.db.close();
});
