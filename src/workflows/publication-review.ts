import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { PublicationReview } from "../contracts/publication.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PrototypeRepository } from "../prototypes/repository.js";
import type { DocumentWorkflow } from "./documents.js";
import type { PlatformService } from "../integrations/platform-service.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
/** Local review only: this module never calls a remote write API. */
export class PublicationReviews {
  private active = new Set<string>();
  constructor(
    private projects: ProjectRepository,
    private versions: PrototypeRepository,
    private documents: DocumentWorkflow,
    private platforms: Pick<PlatformService, "profile" | "test">,
  ) {}
  private path(id: string, name: string) {
    return projectPath(this.projects.context(id).workspace, name);
  }
  list(id: string): PublicationReview[] {
    const path = this.path(id, "documents/publication-reviews.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  }
  private save(id: string, review: PublicationReview) {
    atomicWrite(
      this.path(id, "documents/publication-reviews.json"),
      JSON.stringify(
        [review, ...this.list(id).filter((r) => r.id !== review.id)],
        null,
        2,
      ),
    );
  }
  private materials(id: string, draftId: string) {
    const draft = this.documents.list(id).find((d) => d.id === draftId);
    if (!draft) throw new Error("当前项目中未找到草稿");
    const version = this.documents.approved(id, draft.versionId);
    if (version.contentHash !== draft.contentHash)
      throw new Error("草稿与批准原型不匹配");
    const images = this.documents.images(id, draftId);
    if (!images.length || images.length > 12)
      throw new Error("发布材料需要 1–12 张批准版本截图");
    const files = [
      { name: "PRD.md", label: "PRD 正文", data: Buffer.from(draft.markdown) },
      {
        name: "prototype.html",
        label: "批准原型",
        data: Buffer.from(this.versions.read(id, version.id)),
      },
      ...images.map((image, index) => ({
        name: `state-${index + 1}.png`,
        label: image.label,
        data: Buffer.from(image.dataUrl.split(",")[1], "base64"),
      })),
    ];
    if (!draft.markdown.trim()) throw new Error("草稿正文为空");
    for (const file of files.slice(2))
      if (
        !file.data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("截图不是有效 PNG，请重新保存页面状态");
    if (
      files.reduce((sum, file) => sum + file.data.length, 0) >
      30 * 1024 * 1024
    )
      throw new Error("发布材料超过 30 MB，请缩小范围");
    return { draft, files };
  }
  private signature(
    review: Omit<PublicationReview, "digest"> | PublicationReview,
  ) {
    return hash(
      JSON.stringify({
        draftId: review.draftId,
        versionId: review.versionId,
        parent: review.parent,
        files: review.files,
      }),
    );
  }
  private async parent(id: string) {
    const before = this.platforms.profile(id, "feishu");
    if (!before?.hasCredential || !before.appId || !before.url)
      throw new Error("请先在项目设置配置飞书应用，并在版本设置填写迭代父节点");
    const target = await this.platforms.test(id, "feishu");
    const after = this.platforms.profile(id, "feishu");
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("飞书配置发生变化，请重新准备审阅包");
    return {
      url: before.url,
      appId: before.appId,
      targetId: target.targetId,
      title: target.title,
    };
  }
  async prepare(id: string, draftId: string): Promise<PublicationReview> {
    if (this.active.has(id)) throw new Error("当前项目正在准备或确认审阅包");
    this.active.add(id);
    try {
      const before = this.materials(id, draftId),
        parent = await this.parent(id),
        after = this.materials(id, draftId);
      const sourceSignature = (source: typeof before) =>
        JSON.stringify({
          draft: source.draft,
          files: source.files.map((f) => [f.name, f.label, hash(f.data)]),
        });
      if (sourceSignature(before) !== sourceSignature(after))
        throw new Error("准备期间材料发生变化，请重新准备");
      const reviewId = randomUUID();
      const review: PublicationReview = {
        id: reviewId,
        draftId,
        versionId: after.draft.versionId,
        createdAt: new Date().toISOString(),
        parent,
        digest: "",
        status: "prepared",
        files: after.files.map((f) => ({
          path: `documents/publication/${reviewId}/${f.name}`,
          label: f.label,
          hash: hash(f.data),
          bytes: f.data.length,
        })),
      };
      review.digest = this.signature(review);
      after.files.forEach((file, i) =>
        atomicWrite(this.path(id, review.files[i].path), file.data),
      );
      this.save(id, review);
      return review;
    } finally {
      this.active.delete(id);
    }
  }
  verify(id: string, reviewId: string): PublicationReview {
    const review = this.list(id).find((r) => r.id === reviewId);
    if (!review || this.signature(review) !== review.digest)
      throw new Error("审阅包不存在或记录已变化，请重新准备");
    const current = this.materials(id, review.draftId);
    if (
      current.draft.versionId !== review.versionId ||
      current.files.length !== review.files.length
    )
      throw new Error("发布材料已变化，请重新准备审阅包");
    for (const [index, file] of review.files.entries()) {
      const bytes = readFileSync(this.path(id, file.path)),
        source = current.files[index];
      if (
        hash(bytes) !== file.hash ||
        bytes.length !== file.bytes ||
        hash(source.data) !== file.hash ||
        source.label !== file.label
      )
        throw new Error("正文、截图或原型已变化，请重新准备审阅包");
    }
    const profile = this.platforms.profile(id, "feishu");
    if (
      !profile?.hasCredential ||
      profile.url !== review.parent.url ||
      profile.appId !== review.parent.appId
    )
      throw new Error("目标飞书连接已变化，请重新准备审阅包");
    return review;
  }
  async approve(id: string, reviewId: string, digest: string) {
    if (this.active.has(id)) throw new Error("当前项目正在准备或确认审阅包");
    this.active.add(id);
    try {
      let review = this.verify(id, reviewId);
      if (digest !== review.digest)
        throw new Error("审阅内容已变化，请重新审阅");
      const parent = await this.parent(id);
      review = this.verify(id, reviewId);
      if (JSON.stringify(parent) !== JSON.stringify(review.parent))
        throw new Error("父节点信息已变化，请重新准备审阅包");
      const approved: PublicationReview = {
        ...review,
        status: "approved",
        approvedAt: new Date().toISOString(),
      };
      this.save(id, approved);
      return approved;
    } finally {
      this.active.delete(id);
    }
  }
  directory(id: string, reviewId: string) {
    const review = this.verify(id, reviewId);
    return this.path(id, `documents/publication/${review.id}`);
  }
}
