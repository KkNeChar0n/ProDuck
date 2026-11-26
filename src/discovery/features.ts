import type { DiscoveryFeature, DiscoveryRun } from "../contracts/discovery.js";

export const featureStates = {
  pending: "待探索",
  exploring: "探索中",
  partial: "部分验证",
  verified: "已验证",
  blocked: "受阻",
};
export const featureKey = (module: string, name: string) =>
  `${module} / ${name}`;
export function verifiedFeature(run: DiscoveryRun, item: DiscoveryFeature) {
  return (
    item.state === "verified" &&
    !item.remaining.trim() &&
    !item.blocker.trim() &&
    !!item.result.trim() &&
    item.evidenceIds.length > 0 &&
    item.evidenceIds.every((id) => run.captureIds.includes(id))
  );
}
export function actionableFeatures(run: DiscoveryRun) {
  return (run.features ?? []).filter(
    (f) => !verifiedFeature(run, f) && f.state !== "blocked",
  );
}
export function updateFeatures(run: DiscoveryRun, updates: unknown): string[] {
  if (updates === undefined) return [];
  if (!Array.isArray(updates) || updates.length > 30)
    throw new Error("功能清单需要最多30条增量更新");
  const next = structuredClone(run.features ?? []);
  const warnings: string[] = [];
  for (const item of updates) {
    const text = (key: string, max: number, required = false) =>
      typeof item?.[key] === "string" &&
      item[key].length <= max &&
      (!required || !!item[key].trim());
    if (
      !text("module", 100, true) ||
      !text("name", 120, true) ||
      !text("goal", 600, true) ||
      !text("result", 1200) ||
      !text("remaining", 600) ||
      !text("blocker", 600) ||
      !text("nextAction", 600) ||
      !Object.hasOwn(featureStates, item.state) ||
      typeof item.requiresWrite !== "boolean" ||
      !Array.isArray(item.evidenceIds) ||
      item.evidenceIds.length > 30 ||
      item.evidenceIds.some(
        (id: unknown) => typeof id !== "string" || !run.captureIds.includes(id),
      ) ||
      !Array.isArray(item.sourceIds) ||
      item.sourceIds.length > 12 ||
      item.sourceIds.some(
        (id: unknown) => !run.sources.some((s) => s.id === id),
      ) ||
      (!item.evidenceIds.length && !item.sourceIds.length) ||
      !run.modules?.some((m) => m.name === item.module)
    )
      throw new Error("功能项缺少有效模块、发现依据或目标；不得编造功能");
    const row: DiscoveryFeature = {
      module: item.module,
      name: item.name,
      goal: item.goal,
      state: item.state,
      result: item.result,
      remaining: item.remaining,
      blocker: item.blocker,
      nextAction: item.nextAction,
      requiresWrite: item.requiresWrite,
      evidenceIds: [...new Set<string>(item.evidenceIds)],
      sourceIds: [...new Set<string>(item.sourceIds)],
    };
    if (row.state === "blocked" && !row.blocker.trim())
      throw new Error("受阻功能必须说明缺少的条件");
    if (row.state !== "verified" && !row.nextAction.trim())
      throw new Error("未完成功能必须说明下一步或解除阻碍的条件");
    const key = featureKey(row.module, row.name);
    row.requiresWrite ||=
      next.some(
        (f) => featureKey(f.module, f.name) === key && f.requiresWrite,
      ) || run.steps.some((step) => step.featureKey === key && step.submitted);
    if (
      row.state === "verified" &&
      (!verifiedFeature(run, row) ||
        (row.requiresWrite &&
          !run.steps.some(
            (step) =>
              step.featureKey === key &&
              step.executed &&
              step.submitted &&
              step.businessActionKey &&
              row.evidenceIds.some(
                (id) =>
                  run.captureIds.indexOf(id) >
                  run.captureIds.indexOf(step.captureId),
              ),
          )))
    ) {
      row.state = "partial";
      row.remaining ||= "缺少与验证目标对应的实际结果依据";
      row.nextAction ||= "补充操作后的页面观察，核对实际结果";
      warnings.push(`${key} 仍有缺口或缺少执行后的依据，保持部分验证`);
    }
    const index = next.findIndex((f) => featureKey(f.module, f.name) === key);
    if (index < 0) next.push(row);
    else next[index] = row;
    if (next.length > 240) throw new Error("已发现240个功能项，请缩小本轮范围");
  }
  run.features = next;
  return warnings;
}
export function featureMarkdown(run: DiscoveryRun) {
  let markdown =
    "## 实际功能探索清单\n\n仅覆盖已发现功能，不代表全部产品。此处为有界摘要，完整目标和依据在模块功能详情中查看。\n\n";
  const rows = run.features ?? [];
  let included = 0;
  for (const f of rows) {
    const clip = (value: string) =>
      value.length > 160 ? value.slice(0, 160) + "…" : value;
    const section = `### ${featureKey(f.module, f.name)} · ${featureStates[f.state]}\n\n目标：${clip(f.goal)}\n\n观察结果：${clip(f.result) || "暂无"}\n\n剩余：${clip(f.remaining) || "未列出"}\n\n阻碍：${clip(f.blocker) || "无"}\n\n下一步：${clip(f.nextAction) || "当前目标已验证"}\n\n页面依据：${f.evidenceIds.slice(0, 3).join("、") || "暂无"}\n资料依据：${f.sourceIds.slice(0, 3).join("、") || "暂无"}\n\n`;
    if (markdown.length + section.length > 14000) break;
    markdown += section;
    included++;
  }
  if (included < rows.length)
    markdown += `\n另有 ${rows.length - included} 项未在此摘要展开，请在模块功能清单查看完整记录。`;
  if (!rows.length)
    markdown +=
      "旧记录尚未按实际功能梳理，请继续探索。不能从旧通用检查项推断完成度。";
  return markdown;
}
export const featureInstructions = `按实际发现维护功能清单，不为每个模块套用同样的新建/编辑模板。依据当前页面控件、交接资料、历史观察和模块摘要识别具体功能，如实际存在的搜索筛选、节点拖拽、连线、执行记录等；未见功能不得编造。新建/编辑存在时仍需深度体验，将具体分支拆成可验证目标。每步返回 features 增量数组，最多30项；稳定module+name标识同一项，更新必须保留累计依据，不能改名重复建项。每项格式 {"module":"实际模块","name":"具体功能及分支","goal":"本项需要核对的结果","state":"pending|exploring|partial|verified|blocked","result":"实际观察结果","remaining":"剩余未验证部分","blocker":"具体缺少的条件，无则空","nextAction":"下一步实际操作或解除阻碍的条件","requiresWrite":false,"evidenceIds":["已提供页面ID"],"sourceIds":["已提供资料ID"]}。每项必须有发现依据，资料只能证明待探索，不能证明已验证。verified需有页面结果、无剩余和阻碍；涉及业务保存/执行结果则requiresWrite=true，必须匹配该功能已执行业务操作及后续页面。返回featureName标识下一动作对应的功能name，必须属于当前module。不要把看到按钮当作功能验证完成，不要用一个笼统功能掩盖未验证分支。优先处理未完成且可执行项，其次重新核对受阻条件；存在可执行项不得finish。所有项受阻时逐项写明条件，不重复声称整个系统已完成。续探结合历史和当前页面补建旧模块清单，不能沿用旧十项100%的判断。`;
