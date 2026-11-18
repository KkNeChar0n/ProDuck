/** Original Produck workflows backed by bundled native services, not third-party scripts. */
export interface BuiltinWorkflow {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: "workbench" | "documents";
  action: string;
  steps: string[];
  requirements: string;
  permissions: string;
  limitation?: string;
}
export const builtinWorkflows: readonly BuiltinWorkflow[] = [
  {
    id: "produck-prototype",
    name: "可操作原型",
    version: "1.0.0",
    description:
      "从页面采集制作模拟原型，按页面或选中元素修改，确认版本后再进入文档流程。",
    entry: "workbench",
    action: "开始制作原型",
    steps: [
      "打开网页并登录，采集目标页面",
      "生成候选原型，体验筛选、弹窗和表单",
      "输入修改要求，核对候选与基线",
      "记录关键路径检查，通过指定版本",
    ],
    requirements: "项目模型配置；网页登录由你在浏览器中完成。",
    permissions: "仅操作当前项目。通过动作绑定具体版本，后续修改必须重新确认。",
  },
  {
    id: "produck-prd-publish",
    name: "PRD 首次发布",
    version: "1.0.0",
    description:
      "使用批准原型的实际状态截图生成 PRD，审阅后发布到飞书，再独立同步云效状态。",
    entry: "documents",
    action: "进入 PRD 工作流",
    steps: [
      "先在工作台通过原型，并保存所需状态截图",
      "选择截图与需求目标，生成并审阅草稿",
      "核对发布材料和飞书迭代父节点，确认发布",
      "读回正文与附件后，按项目映射核对并同步云效",
    ],
    requirements:
      "生成正文需要项目模型；发布需要飞书连接；云效同步需要中心版 PAT 与状态映射。本地草稿可独立导出。",
    permissions:
      "发布到飞书和更新云效状态分别确认；模型与技能说明不能代替确认。",
    limitation: "首次发布不会覆盖迭代中其他版本的共用原型。",
  },
  {
    id: "produck-prd-review",
    name: "PRD 差异评审",
    version: "1.0.0",
    description: "读取已发布文档，选择章节制作差异，独立批准后检查合并条件。",
    entry: "documents",
    action: "进入文档差异评审",
    steps: [
      "打开本项目已成功发布的文档记录",
      "读取线上最新内容，选择可编辑文字章节",
      "修改并审阅增删差异，独立批准文档修改",
      "执行只读合并预检；发现目标变化后重新评审",
    ],
    requirements: "本项目的飞书发布记录与有效飞书连接。",
    permissions:
      "仅读取飞书并保存本地差异，不修改线上原文。原型确认不能替代文档差异批准。",
    limitation: "原文合并与共用附件更新暂缓，目前支持差异评审及只读预检。",
  },
];
