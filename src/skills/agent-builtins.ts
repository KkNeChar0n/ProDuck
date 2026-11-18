import { createHash } from "node:crypto";
import type { ImportedSkill } from "../contracts/skills.js";
const entries = [
  {
    id: "builtin:prototype",
    name: "内置 · 原型制作",
    description: "读取采集依据，生成或修改候选原型，交给用户体验与确认。",
    text: "先用 project_sources 与 product_artifacts 获取当前项目的页面与原型 ID，不猜测 ID。缺少页面时请用户在工作台登录并采集，或使用受控浏览器工具。用 generate_prototype 生成候选；修改已有原型时传 baselineId 与 change。生成需逐次授权。完成后说明版本 ID，请用户在工作台体验、记录检查并通过。不得声称候选已获批准，不得伪造检查结果。",
  },
  {
    id: "builtin:prd",
    name: "内置 · PRD 草稿",
    description: "基于已批准原型和对应截图生成草稿，保持审阅和发布独立。",
    text: "先用 product_artifacts 查看批准原型及截图。版本未通过或没有对应状态截图时，请用户先在工作台完成，不得自己通过版本或伪造截图。用 generate_prd 传 versionId、stateIds（JSON 字符串数组）、goal 生成草稿，需逐次授权。使用 read_prd 审阅内容，遇到 truncated 必须说明未读全文。完成后报告草稿 ID，指引用户到文档页审阅与准备发布。不得声称已经发布、合并或同步云效；这些动作需在文档页独立确认。",
  },
];
export const agentBuiltins = entries.map((entry) => ({
  ...entry,
  fingerprint: createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
}));
export function builtinSkillRecords(): ImportedSkill[] {
  return agentBuiltins.map(({ id, name, description, fingerprint }) => ({
    id,
    name,
    description,
    fingerprint,
    source: "Produck 内置",
    importedAt: "",
    resources: [],
    status: "needs-approval",
    reasons: [],
    mappings: [],
  }));
}
