import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ProjectRepository } from "../projects/repository.js";
import type { PublicationWorkflow } from "./publication.js";
import type { PlatformService } from "../integrations/platform-service.js";
import type { FeishuPort, FeishuBlock } from "../integrations/feishu.js";
import type {
  RemoteDocumentSnapshot,
  RemoteSection,
  DocumentChangeReview,
  DocumentMergePlan,
} from "../contracts/document-review.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function text(block: FeishuBlock): string {
  const key =
    block.block_type === 2
      ? "text"
      : block.block_type >= 3 && block.block_type <= 11
        ? `heading${block.block_type - 2}`
        : "";
  if (!key) return "";
  return (block[key]?.elements ?? [])
    .map((e: any) => e.text_run?.content ?? "[非文字内容]")
    .join("");
}
export function sections(blocks: FeishuBlock[]): RemoteSection[] {
  const result: RemoteSection[] = [];
  let group:
    | {
        title: string;
        parts: string[];
        blocks: FeishuBlock[];
        editable: boolean;
        spans: RemoteSection["spans"];
      }
    | undefined;
  const finish = () => {
    if (!group) return;
    const ids = group.blocks.map((b) => b.block_id!);
    result.push({
      id: hash([ids[0], group.spans[0]?.start, group.title]).slice(0, 24),
      title: group.title,
      text: group.parts.join(""),
      editable: group.editable,
      blockIds: ids,
      spans: group.spans,
      fingerprint: hash(group.blocks),
    });
    group = undefined;
  };
  for (const block of blocks) {
    if (!block.block_id) throw new Error("远端文档缺少稳定块标识");
    const content = text(block);
    const style = block.text?.elements?.[0]?.text_run?.text_element_style;
    const neutralStyle =
      !style ||
      Object.entries(style).every(
        ([key, value]) =>
          value == null ||
          value === false ||
          (key === "comment_ids" && Array.isArray(value) && value.length === 0),
      );
    const plain =
      block.block_type === 2 &&
      !block.children?.length &&
      block.text?.elements?.length === 1 &&
      typeof block.text.elements[0].text_run?.content === "string" &&
      neutralStyle;
    const heading = block.block_type >= 3 && block.block_type <= 11;
    const protectedBlock =
      /^Produck (发布|共用原型)/.test(content) || (!plain && !heading);
    if (protectedBlock) {
      finish();
      group = {
        title:
          content.slice(0, 70) ||
          (block.block_type === 27
            ? "页面截图"
            : block.block_type === 23
              ? "原型附件"
              : "其他内容"),
        parts: [content || `[保留原始块：${block.block_type}]`],
        blocks: [block],
        editable: false,
        spans: [{ blockId: block.block_id, start: 0, end: content.length }],
      };
      finish();
      continue;
    }
    const starts = [
      0,
      ...Array.from(content.matchAll(/^#{1,6}\s+[^\n]+/gm))
        .map((m) => m.index!)
        .filter((i) => i > 0),
    ];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i],
        end = starts[i + 1] ?? content.length,
        part = content.slice(start, end),
        markdownTitle = part.match(/^#{1,6}\s+([^\n]+)/)?.[1];
      if (heading || markdownTitle || !group) {
        finish();
        group = {
          title: heading ? content : (markdownTitle ?? "正文"),
          parts: [],
          blocks: [],
          editable: plain,
          spans: [],
        };
      }
      group!.parts.push(part);
      group!.blocks.push(block);
      group!.spans.push({ blockId: block.block_id, start, end });
      group!.editable &&= plain;
    }
  }
  finish();
  return result;
}
export function lineDiff(
  before: string,
  after: string,
): DocumentChangeReview["diff"] {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  return [
    ...a.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...a
      .slice(start, a.length - end)
      .map((text) => ({ kind: "removed" as const, text })),
    ...b
      .slice(start, b.length - end)
      .map((text) => ({ kind: "added" as const, text })),
    ...a.slice(a.length - end).map((text) => ({ kind: "same" as const, text })),
  ];
}
export class DocumentReviews {
  constructor(
    private projects: ProjectRepository,
    private publications: Pick<PublicationWorkflow, "list">,
    private platforms: Pick<PlatformService, "profile">,
    private connect: (id: string) => Promise<FeishuPort>,
  ) {}
  private read<T>(id: string, path: string, fallback: T): T {
    const file = projectPath(this.projects.context(id).workspace, path);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  }
  private write(id: string, path: string, value: unknown) {
    atomicWrite(
      projectPath(this.projects.context(id).workspace, path),
      JSON.stringify(value, null, 2),
    );
  }
  snapshots(id: string): RemoteDocumentSnapshot[] {
    return this.read(id, "documents/remote-snapshots.json", []);
  }
  reviews(id: string): DocumentChangeReview[] {
    return this.read(id, "documents/change-reviews.json", []);
  }
  private save(id: string, review: DocumentChangeReview) {
    this.write(id, "documents/change-reviews.json", [
      review,
      ...this.reviews(id).filter((r) => r.id !== review.id),
    ]);
  }
  private async remote(id: string, runId: string) {
    const run = this.publications
      .list(id)
      .find((r) => r.id === runId && r.state === "published");
    if (!run?.documentUrl) throw new Error("当前项目没有此已发布文档");
    const profile = this.platforms.profile(id, "feishu");
    if (!profile?.hasCredential || profile.url !== run.parentUrl)
      throw new Error("飞书连接与发布记录不匹配，请恢复原项目连接");
    const client = await this.connect(id),
      token = new URL(run.documentUrl).pathname.split("/")[2],
      node = await client.node(token);
    if (
      node.parent_node_token !== new URL(run.parentUrl).pathname.split("/")[2]
    )
      throw new Error("远端文档已移动，需重新核对父节点");
    const blocks = await client.blocks(node.obj_token);
    if (
      JSON.stringify(profile) !==
      JSON.stringify(this.platforms.profile(id, "feishu"))
    )
      throw new Error("读取期间项目连接变化，请重试");
    if (JSON.stringify(blocks).length > 2_000_000)
      throw new Error("文档超过当前评审范围，请缩小内容");
    return { run, node, blocks, client };
  }
  async fetch(id: string, runId: string): Promise<RemoteDocumentSnapshot> {
    const { run, node, blocks } = await this.remote(id, runId);
    const snapshot: RemoteDocumentSnapshot = {
      id: randomUUID(),
      runId,
      documentId: node.obj_token,
      nodeToken: node.node_token,
      title: node.title,
      url: run.documentUrl!,
      fetchedAt: new Date().toISOString(),
      sections: sections(blocks),
    };
    this.write(id, `documents/remote-${snapshot.id}.json`, blocks);
    this.write(id, "documents/remote-snapshots.json", [
      snapshot,
      ...this.snapshots(id),
    ]);
    return snapshot;
  }
  private checkedSnapshot(id: string, snapshotId: string) {
    const snapshot = this.snapshots(id).find((s) => s.id === snapshotId);
    if (!snapshot) throw new Error("快照不属于当前项目");
    const original = this.read<FeishuBlock[]>(
      id,
      `documents/remote-${snapshot.id}.json`,
      [],
    );
    if (hash(sections(original)) !== hash(snapshot.sections))
      throw new Error("本地快照内容已变化，请重新读取线上文档");
    return snapshot;
  }
  prepare(
    id: string,
    snapshotId: string,
    sectionId: string,
    after: string,
  ): DocumentChangeReview {
    const snapshot = this.checkedSnapshot(id, snapshotId),
      section = snapshot?.sections.find((s) => s.id === sectionId);
    if (!section?.editable)
      throw new Error(
        "此内容包含格式、链接或非文字块，当前只支持普通文字范围评审",
      );
    if (
      typeof after !== "string" ||
      after.length > 30000 ||
      section.text.length > 30000
    )
      throw new Error("单次文字评审最多 30000 字");
    if (after === section.text) throw new Error("内容未变化");
    const review: DocumentChangeReview = {
      id: randomUUID(),
      snapshotId,
      sectionId,
      title: section.title,
      before: section.text,
      after,
      fingerprint: section.fingerprint,
      digest: hash([
        snapshotId,
        sectionId,
        section.fingerprint,
        section.text,
        after,
      ]),
      createdAt: new Date().toISOString(),
      state: "pending",
      diff: lineDiff(section.text, after),
    };
    this.save(id, review);
    return review;
  }
  async preflight(
    id: string,
    reviewId: string,
    digest: string,
  ): Promise<DocumentMergePlan> {
    const review = this.reviews(id).find((r) => r.id === reviewId);
    if (
      !review ||
      review.state !== "approved" ||
      !review.approvedAt ||
      review.digest !== digest ||
      hash([
        review.snapshotId,
        review.sectionId,
        review.fingerprint,
        review.before,
        review.after,
      ]) !== digest
    )
      throw new Error("请先批准当前差异，不能用原型批准代替文档批准");
    const snapshot = this.checkedSnapshot(id, review.snapshotId);
    const { node, client } = await this.remote(id, snapshot.runId);
    if (!client.revision) throw new Error("当前连接不支持版本预检");
    const revision = await client.revision(node.obj_token);
    const blocks = await client.blocks(node.obj_token);
    if ((await client.revision(node.obj_token)) !== revision)
      throw new Error("预检期间文档发生变化，请重试；未执行写入");
    const current = sections(blocks).find(
      (section) => section.id === review.sectionId,
    );
    if (
      node.obj_token !== snapshot.documentId ||
      !current?.editable ||
      current.fingerprint !== review.fingerprint ||
      current.text !== review.before
    ) {
      this.save(id, { ...review, state: "conflict", approvedAt: undefined });
      throw new Error("目标章节已变化，批准失效，请重新读取和评审");
    }
    const edits = current.spans.map((span, index) => {
      const block = blocks.find((b) => b.block_id === span.blockId)!;
      const before = text(block),
        replacement = index === 0 ? review.after : "";
      const suffix = before.slice(span.end);
      if (replacement && suffix.startsWith("#") && !replacement.endsWith("\n"))
        throw new Error(
          "修改内容末尾需保留换行，避免与下一章节标题粘连；请重新编辑并评审",
        );
      return {
        blockId: span.blockId,
        before,
        after: before.slice(0, span.start) + replacement + suffix,
      };
    });
    if (new Set(edits.map((edit) => edit.blockId)).size !== edits.length)
      throw new Error("同一块内存在多个修改范围，请缩小评审范围");
    if (edits.some((edit) => edit.after.length > 100000))
      throw new Error("修改后单个文本块超过飞书长度限制");
    if (this.reviews(id).find((r) => r.id === reviewId)?.state !== "approved")
      throw new Error("差异批准已失效");
    const plan: DocumentMergePlan = {
      id: randomUUID(),
      reviewId,
      digest,
      documentId: node.obj_token,
      checkedAt: new Date().toISOString(),
      revision,
      edits,
      writeEnabled: false,
    };
    this.write(id, `documents/merge-plan-${plan.id}.json`, plan);
    return plan;
  }
  async approve(
    id: string,
    reviewId: string,
    digest: string,
  ): Promise<DocumentChangeReview> {
    const review = this.reviews(id).find((r) => r.id === reviewId),
      snapshot = this.snapshots(id).find((s) => s.id === review?.snapshotId);
    if (
      !review ||
      !snapshot ||
      review.digest !== digest ||
      hash([
        review.snapshotId,
        review.sectionId,
        review.fingerprint,
        review.before,
        review.after,
      ]) !== digest
    )
      throw new Error("差异记录已变化，请重新评审");
    this.checkedSnapshot(id, snapshot.id);
    const { node, blocks } = await this.remote(id, snapshot.runId),
      current = sections(blocks).find((s) => s.id === review.sectionId);
    if (
      node.obj_token !== snapshot.documentId ||
      !current ||
      current.fingerprint !== review.fingerprint
    ) {
      const conflicted = {
        ...review,
        state: "conflict" as const,
        approvedAt: undefined,
      };
      this.save(id, conflicted);
      return conflicted;
    }
    const approved = {
      ...review,
      state: "approved" as const,
      approvedAt: new Date().toISOString(),
    };
    this.save(id, approved);
    return approved;
  }
}
