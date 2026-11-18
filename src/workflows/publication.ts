import { existsSync, readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { basename } from "node:path";
import type { PublicationRun } from "../contracts/publication.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PublicationReviews } from "./publication-review.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
import {
  blockText,
  textBlock,
  type FeishuPort,
  type FeishuBlock,
  type WikiNode,
} from "../integrations/feishu.js";

export class PublicationWorkflow {
  private active = new Set<string>();
  constructor(
    private projects: ProjectRepository,
    private reviews: PublicationReviews,
    private connect: (id: string) => Promise<FeishuPort>,
  ) {}
  private path(id: string) {
    return projectPath(
      this.projects.get(id).workspace,
      "workflows/publications.json",
    );
  }
  list(id: string): PublicationRun[] {
    const path = this.path(id);
    const runs: PublicationRun[] = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
    return runs.map((run) =>
      run.state === "running" && !this.active.has(id)
        ? {
            ...run,
            state: "needs-check",
            message: "发布中断，请核对并继续；不自动重放写入",
          }
        : run,
    );
  }
  private save(id: string, run: PublicationRun) {
    run.updatedAt = new Date().toISOString();
    atomicWrite(
      this.path(id),
      JSON.stringify(
        [run, ...this.list(id).filter((r) => r.id !== run.id)],
        null,
        2,
      ),
    );
  }
  async publish(
    id: string,
    reviewId: string,
    digest: string,
    title: string,
  ): Promise<PublicationRun> {
    if (this.active.has(id)) throw new Error("当前项目已有发布正在执行");
    if (typeof title !== "string" || !title.trim() || title.length > 80)
      throw new Error("请填写 1–80 字的需求文档标题");
    const review = this.reviews.verify(id, reviewId);
    if (review.status !== "approved" || review.digest !== digest)
      throw new Error("请先确认这份发布材料及父节点");
    const existing = this.list(id).find((r) => r.draftId === review.draftId);
    if (
      existing &&
      (existing.reviewId !== reviewId || existing.digest !== digest)
    )
      throw new Error("此草稿已有发布记录，请先核对原记录，不能另建重复文档");
    const run: PublicationRun = existing ?? {
      id: randomUUID(),
      reviewId,
      draftId: review.draftId,
      digest,
      title: title.trim(),
      parentUrl: review.parent.url,
      state: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
    };
    if (existing && existing.title !== title.trim())
      throw new Error("恢复时标题需与原发布记录一致");
    this.active.add(id);
    try {
      run.state = "running";
      run.message = undefined;
      this.save(id, run);
      const client = await this.connect(id);
      const parent = await client.node(review.parent.targetId);
      if (parent.title !== review.parent.title)
        throw new Error("父节点标题已变化，请核对目标");
      // Every write validates the exact local review again. Pending writes are reconciled, never blindly replayed.
      const step = async <T>(
        key: string,
        write: (requestId: string) => Promise<T>,
        recover: () => Promise<T | undefined>,
      ): Promise<T> => {
        this.reviews.verify(id, reviewId);
        let receipt = run.steps.find((s) => s.key === key);
        if (receipt?.state === "done") return receipt.result as T;
        if (receipt) {
          const found = await recover();
          if (found === undefined)
            throw new Error(
              `步骤 ${key} 结果不确定，请在飞书人工核对；本次未重复写入`,
            );
          receipt.state = "done";
          receipt.result = found;
          this.save(id, run);
          return found;
        }
        receipt = { key, requestId: randomUUID(), state: "pending" };
        run.steps.push(receipt);
        this.save(id, run);
        try {
          const result = await write(receipt.requestId);
          receipt.result = result;
          receipt.state = "done";
          this.save(id, run);
          return result;
        } catch (error) {
          receipt.state = "uncertain";
          this.save(id, run);
          throw error;
        }
      };
      const assets = review.files.map((file) => ({
        ...file,
        bytes: readFileSync(
          projectPath(this.projects.get(id).workspace, file.path),
        ),
      }));
      if (assets.some((f) => f.bytes.length > 20 * 1024 * 1024))
        throw new Error("飞书单个素材上传限 20 MB，请缩小截图后重新准备");
      const prototype = assets[1],
        commonMarker = `Produck 共用原型 SHA256:${prototype.hash}`;
      let parentBlocks = await client.blocks(parent.obj_token);
      const commonMarkers = parentBlocks.filter((b) =>
        blockText(b).startsWith("Produck 共用原型 SHA256:"),
      );
      if (
        commonMarkers.some((b) => blockText(b) !== commonMarker) ||
        commonMarkers.length > 1
      )
        throw new Error(
          "此迭代已存在其他共用原型，需通过后续差异合并流程更新，首次发布不会覆盖它",
        );
      const recoverBlocks = async (
        document: string,
        marker: string,
        expected: FeishuBlock[],
      ) => {
        const blocks = await client.blocks(document),
          indexes = blocks.flatMap((b, i) =>
            blockText(b) === marker ? [i] : [],
          );
        if (indexes.length !== 1) return undefined;
        const found = blocks.slice(indexes[0], indexes[0] + expected.length);
        if (
          found.length !== expected.length ||
          found.some(
            (b, i) =>
              b.block_type !== expected[i].block_type ||
              (expected[i].block_type === 2 &&
                blockText(b) !== blockText(expected[i])),
          )
        )
          return undefined;
        return found;
      };
      const commonExpected = [
        textBlock(commonMarker),
        { block_type: 23, file: {} },
      ];
      const common = await step(
        "shared-block",
        async (requestId) => {
          if (!commonMarkers.length)
            return client.append(parent.obj_token, commonExpected, requestId);
          const found = await recoverBlocks(
            parent.obj_token,
            commonMarker,
            commonExpected,
          );
          if (!found) throw new Error("共用原型附件块不完整");
          return found;
        },
        () => recoverBlocks(parent.obj_token, commonMarker, commonExpected),
      );
      if (!common?.[1]?.block_id)
        throw new Error("共用原型附件块不完整，请先核对父节点");
      const sharedBlock = common[1];
      const currentShared = (await client.blocks(parent.obj_token)).find(
        (b) => b.block_id === sharedBlock.block_id,
      );
      if (!currentShared) throw new Error("共用附件块已被删除");
      const sharedToken = await step(
        "shared-upload",
        async () =>
          currentShared.file?.token ||
          client.upload(
            sharedBlock.block_id!,
            "Produck-prototype.html",
            prototype.bytes,
            false,
          ),
        async () => currentShared.file?.token,
      );
      await step(
        "shared-bind",
        async (requestId) => {
          if (
            currentShared.file?.token &&
            currentShared.file.token !== sharedToken
          )
            throw new Error("共用附件已被修改，停止覆盖");
          if (!currentShared.file?.token)
            await client.bind(
              parent.obj_token,
              sharedBlock.block_id!,
              sharedToken,
              false,
              requestId,
            );
          return true;
        },
        async () =>
          (await client.blocks(parent.obj_token)).some(
            (b) =>
              b.block_id === sharedBlock.block_id &&
              b.file?.token === sharedToken,
          )
            ? true
            : undefined,
      );
      if (
        createHash("sha256")
          .update(await client.download(sharedToken!))
          .digest("hex") !== prototype.hash
      )
        throw new Error("共用原型附件内容不匹配，停止发布");
      const titleWithMarker = `${run.title} · Produck ${run.id.slice(0, 8)}`;
      const node = await step<WikiNode>(
        "create-document",
        () =>
          client.createNode(
            parent.space_id,
            parent.node_token,
            titleWithMarker,
          ),
        async () => {
          const matches = (
            await client.children(parent.space_id, parent.node_token)
          ).filter(
            (n) =>
              n.title === titleWithMarker &&
              n.obj_type === "docx" &&
              n.parent_node_token === parent.node_token,
          );
          return matches.length === 1 ? matches[0] : undefined;
        },
      );
      const confirmedNode = await client.node(node.node_token);
      if (
        confirmedNode.parent_node_token !== parent.node_token ||
        confirmedNode.space_id !== parent.space_id ||
        confirmedNode.obj_token !== node.obj_token
      )
        throw new Error("创建文档父节点读回不匹配");
      run.documentUrl = `${new URL(review.parent.url).origin}/wiki/${node.node_token}`;
      this.save(id, run);
      const markdown = assets[0].bytes.toString("utf8"),
        characters = Array.from(markdown),
        body: FeishuBlock[] = [];
      for (let i = 0; i < characters.length; i += 1500)
        body.push(textBlock(characters.slice(i, i + 1500).join("")));
      body.unshift(
        textBlock(
          "共用交互原型：打开迭代父节点中的 Produck-prototype.html 附件",
          review.parent.url,
        ),
      );
      const expectedBody: FeishuBlock[] = [];
      for (let i = 0; i < body.length; i += 45) {
        const marker = `Produck 发布 ${run.id} 正文 ${i / 45 + 1}`;
        const batch = [textBlock(marker), ...body.slice(i, i + 45)];
        const result = await step(
          `body-${i}`,
          (requestId) => client.append(node.obj_token, batch, requestId),
          () => recoverBlocks(node.obj_token, marker, batch),
        );
        if (
          result.length !== batch.length ||
          result.some(
            (block, index) => blockText(block) !== blockText(batch[index]),
          )
        )
          throw new Error("正文写入结果与审阅内容不一致");
        expectedBody.push(...result);
      }
      const imageChecks: { blockId: string; token: string; hash: string }[] =
        [];
      for (let index = 2; index < assets.length; index++) {
        const asset = assets[index],
          marker = `Produck 发布 ${run.id} 截图 ${index - 1}：${asset.label}`;
        const expected = [textBlock(marker), { block_type: 27, image: {} }];
        const blocks = await step(
          `image-block-${index}`,
          (requestId) => client.append(node.obj_token, expected, requestId),
          () => recoverBlocks(node.obj_token, marker, expected),
        );
        const blockId = blocks[1].block_id!;
        const token = await step(
          `image-upload-${index}`,
          () => client.upload(blockId, basename(asset.path), asset.bytes, true),
          async () => undefined,
        );
        await step(
          `image-bind-${index}`,
          async (requestId) => {
            await client.bind(node.obj_token, blockId, token, true, requestId);
            return true;
          },
          async () =>
            (await client.blocks(node.obj_token)).some(
              (b) => b.block_id === blockId && b.image?.token === token,
            )
              ? true
              : undefined,
        );
        imageChecks.push({ blockId, token, hash: asset.hash });
      }
      this.reviews.verify(id, reviewId);
      const remote = await client.blocks(node.obj_token);
      for (const expected of expectedBody) {
        const actual = remote.find((b) => b.block_id === expected.block_id);
        if (!actual || blockText(actual) !== blockText(expected))
          throw new Error("正文读回不一致，未确认发布成功");
      }
      const link = remote.find((b) => b.block_id === expectedBody[1]?.block_id)
        ?.text?.elements?.[0]?.text_run?.text_element_style?.link?.url;
      if (link !== review.parent.url) throw new Error("共用原型入口读回不一致");
      if (
        imageChecks.some(
          (c) =>
            !remote.some(
              (b) => b.block_id === c.blockId && b.image?.token === c.token,
            ),
        )
      )
        throw new Error("截图素材绑定读回不一致");
      for (const image of imageChecks)
        if (
          createHash("sha256")
            .update(await client.download(image.token))
            .digest("hex") !== image.hash
        )
          throw new Error("截图下载内容不一致，未确认发布成功");
      parentBlocks = await client.blocks(parent.obj_token);
      if (
        !parentBlocks.some(
          (b) =>
            b.block_id === sharedBlock.block_id &&
            b.file?.token === sharedToken,
        )
      )
        throw new Error("共用附件绑定读回不一致");
      run.state = "published";
      run.message =
        "正文、截图文件及共用原型入口已读回核对；云效同步另有独立收据";
      this.save(id, run);
      return run;
    } catch (error) {
      run.state = run.steps.some((s) => s.state !== "done")
        ? "needs-check"
        : "partial";
      run.message = error instanceof Error ? error.message : "发布未完成";
      this.save(id, run);
      return run;
    } finally {
      this.active.delete(id);
    }
  }
}
