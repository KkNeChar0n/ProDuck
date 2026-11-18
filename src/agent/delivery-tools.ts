import type { AgentTool } from "./tools.js";
import type { PublicationReviews } from "../workflows/publication-review.js";
import type { PublicationWorkflow } from "../workflows/publication.js";
import type { DocumentReviews } from "../workflows/document-review.js";
import type { YunxiaoSyncWorkflow } from "../workflows/yunxiao-sync.js";
export function deliveryTools(
  reviews: Pick<PublicationReviews, "prepare" | "list">,
  publisher: Pick<PublicationWorkflow, "list">,
  changes: Pick<DocumentReviews, "fetch" | "snapshots" | "prepare">,
  sync: Pick<YunxiaoSyncWorkflow, "prepare" | "list">,
): AgentTool[] {
  return [
    {
      description: {
        name: "delivery_records",
        description:
          "查看本项目发布材料、发布结果与云效同步收据摘要；待确认不等于已完成",
        args: {},
        required: [],
        approval: false,
      },
      run: (c) => ({
        reviews: reviews
          .list(c.projectId)
          .map(({ id, draftId, status }) => ({ id, draftId, status })),
        publications: publisher
          .list(c.projectId)
          .map(({ id, draftId, title, state, documentUrl, message }) => ({
            id,
            draftId,
            title,
            state,
            documentUrl,
            message,
          })),
        sync: sync
          .list(c.projectId)
          .map(({ id, publicationId, item, target, state, message }) => ({
            id,
            publicationId,
            itemId: item.id,
            target,
            state,
            message,
          })),
      }),
    },
    {
      description: {
        name: "prepare_publication",
        description:
          "读取飞书父节点并固定本项目 PRD 发布材料，保存本地待审阅包；不批准、不发布",
        args: { draftId: "string" },
        required: ["draftId"],
        approval: true,
      },
      run: async (c, a) => {
        const r = await reviews.prepare(c.projectId, a.draftId);
        return {
          id: r.id,
          draftId: r.draftId,
          status: r.status,
          parent: r.parent,
          next: "请到文档页核对材料与父节点，独立确认发布",
        };
      },
    },
    {
      description: {
        name: "fetch_published_prd",
        description:
          "读取本项目已发布飞书文档，保存快照并返回章节索引；文字需用 read_prd_section 读取",
        args: { publicationId: "string" },
        required: ["publicationId"],
        approval: true,
      },
      run: async (c, a) => {
        const s = await changes.fetch(c.projectId, a.publicationId);
        return {
          id: s.id,
          title: s.title,
          sections: s.sections.map(({ id, title, editable, text }) => ({
            id,
            title,
            editable,
            characters: text.length,
          })),
        };
      },
    },
    {
      description: {
        name: "read_prd_section",
        description:
          "读取本项目线上快照的指定章节，最多 16000 字；截断章节不可用此工具准备替换",
        args: { snapshotId: "string", sectionId: "string" },
        required: ["snapshotId", "sectionId"],
        approval: false,
      },
      run: (c, a) => {
        const s = changes
          .snapshots(c.projectId)
          .find((s) => s.id === a.snapshotId)
          ?.sections.find((s) => s.id === a.sectionId);
        if (!s) throw new Error("章节不属于当前项目快照");
        return {
          id: s.id,
          title: s.title,
          editable: s.editable,
          text: s.text.slice(0, 16000),
          truncated: s.text.length > 16000,
        };
      },
    },
    {
      description: {
        name: "prepare_prd_change",
        description:
          "为已完整读取的普通文字章节保存本地差异，after 为完整新章节内容；空字符串表示删除。待用户独立审阅，不合并原文",
        args: { snapshotId: "string", sectionId: "string", after: "string" },
        required: ["snapshotId", "sectionId", "after"],
        approval: true,
      },
      run: (c, a) => {
        const section = changes
          .snapshots(c.projectId)
          .find((s) => s.id === a.snapshotId)
          ?.sections.find((s) => s.id === a.sectionId);
        if (!section || section.text.length > 16000)
          throw new Error("章节不存在或过长，请在文档页审阅");
        const r = changes.prepare(
          c.projectId,
          a.snapshotId,
          a.sectionId,
          a.after,
        );
        return {
          id: r.id,
          title: r.title,
          state: r.state,
          next: "请到文档页审阅差异并独立批准；原文合并暂缓",
        };
      },
    },
    {
      description: {
        name: "prepare_yunxiao_sync",
        description:
          "读取云效工作项并按项目映射准备状态同步计划；不执行状态写入",
        args: { publicationId: "string", itemId: "string" },
        required: ["publicationId", "itemId"],
        approval: true,
      },
      run: (c, a) => sync.prepare(c.projectId, a.publicationId, a.itemId),
    },
  ];
}
