import type { AgentTool } from "./tools.js";
import type { PrototypeRepository } from "../prototypes/repository.js";
import type { PrototypeGenerator } from "./prototype-generator.js";
import type { DocumentWorkflow } from "../workflows/documents.js";
/** Local artifacts only. Approval and remote publication remain explicit UI actions. */
export function productTools(
  versions: Pick<PrototypeRepository, "list">,
  generator: Pick<PrototypeGenerator, "generate">,
  documents: Pick<DocumentWorkflow, "list" | "states" | "generate">,
): AgentTool[] {
  return [
    {
      description: {
        name: "product_artifacts",
        description:
          "列出本项目原型版本、批准状态、已保存页面截图和 PRD 草稿元数据",
        args: {},
        required: [],
        approval: false,
      },
      run: (c) => ({
        versions: versions.list(c.projectId),
        states: documents
          .states(c.projectId)
          .map(({ id, versionId, contentHash, label }) => ({
            id,
            versionId,
            contentHash,
            label,
          })),
        drafts: documents
          .list(c.projectId)
          .map(({ markdown: _body, ...draft }) => draft),
      }),
    },
    {
      description: {
        name: "generate_prototype",
        description:
          "使用已采集页面生成新候选原型；可指定本项目基线版本与修改要求。消耗模型额度，不自动通过版本。",
        args: { captureId: "string", change: "string", baselineId: "string" },
        required: ["captureId"],
        approval: true,
      },
      run: (c, a) =>
        generator.generate(
          c.projectId,
          a.captureId,
          () => {},
          a.change,
          a.baselineId,
          undefined,
          c.signal,
        ),
    },
    {
      description: {
        name: "generate_prd",
        description:
          "从已批准原型及已保存的对应截图生成本地 PRD 草稿；stateIds 为截图 ID 的 JSON 字符串数组。消耗模型额度，不发布。",
        args: { versionId: "string", stateIds: "string", goal: "string" },
        required: ["versionId", "stateIds", "goal"],
        approval: true,
      },
      run: async (c, a) => {
        let ids: unknown;
        try {
          ids = JSON.parse(a.stateIds);
        } catch {
          throw new Error("截图 ID 必须为 JSON 字符串数组");
        }
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 12 ||
          ids.some((id) => typeof id !== "string" || !id)
        )
          throw new Error("请选择 1–12 个截图 ID");
        const { markdown, ...draft } = await documents.generate(
          c.projectId,
          a.versionId,
          ids,
          a.goal,
          c.signal,
        );
        return {
          ...draft,
          preview: markdown.slice(0, 8000),
          next: "请在文档页审阅完整草稿并独立确认发布",
        };
      },
    },
    {
      description: {
        name: "read_prd",
        description: "读取当前项目指定 PRD 草稿，长文截取前 16000 字并标明截断",
        args: { draftId: "string" },
        required: ["draftId"],
        approval: false,
      },
      run: (c, a) => {
        const draft = documents
          .list(c.projectId)
          .find((d) => d.id === a.draftId);
        if (!draft) throw new Error("草稿不属于当前项目");
        return {
          ...draft,
          markdown: draft.markdown.slice(0, 16000),
          truncated: draft.markdown.length > 16000,
        };
      },
    },
  ];
}
