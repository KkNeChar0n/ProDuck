import type {
  DiscoveryCheck,
  DiscoveryCoverage,
  DiscoveryRun,
} from "../contracts/discovery.js";

export const checks: DiscoveryCheck[] = [
  "entry",
  "fields",
  "validation",
  "cancel",
  "save",
];
export const checkNames: Record<DiscoveryCheck, string> = {
  entry: "入口",
  fields: "字段与默认值/回填",
  validation: "校验约束",
  cancel: "取消",
  save: "保存后结果",
};
export function ensureModule(run: DiscoveryRun, module: string) {
  run.coverage ??= [];
  if (run.coverage.some((c) => c.module === module)) return;
  if (run.coverage.length >= 24)
    throw new Error("本轮模块过多，请缩小关注范围");
  for (const flow of ["create", "edit"] as const)
    run.coverage.push({
      module,
      flow,
      checks: [],
      evidenceIds: [],
      detail: "",
      limitation: "",
    });
}
/** Coverage is a model assessment anchored to captured evidence, not a DOM success oracle. */
export function updateCoverage(run: DiscoveryRun, updates: unknown): string[] {
  if (updates === undefined) return [];
  if (!Array.isArray(updates) || updates.length > 40)
    throw new Error("体验清单格式无效");
  const warnings: string[] = [];
  for (const update of updates) {
    if (
      !update ||
      typeof update.module !== "string" ||
      !["create", "edit"].includes(update.flow) ||
      !Array.isArray(update.checks) ||
      update.checks.length > 5 ||
      update.checks.some(
        (x: unknown) => !checks.includes(x as DiscoveryCheck),
      ) ||
      !Array.isArray(update.evidenceIds) ||
      (update.checks.length > 0 && !update.evidenceIds.length) ||
      update.evidenceIds.length > 120 ||
      update.evidenceIds.some(
        (id: unknown) => typeof id !== "string" || !run.captureIds.includes(id),
      ) ||
      typeof update.detail !== "string" ||
      update.detail.length > 1200 ||
      typeof update.limitation !== "string" ||
      update.limitation.length > 600
    )
      throw new Error("体验清单缺少有效依据或说明");
    const row = run.coverage?.find(
      (c) => c.module === update.module && c.flow === update.flow,
    );
    if (!row) throw new Error("体验清单引用未观察的模块");
    const accepted = [...new Set<DiscoveryCheck>(update.checks)];
    if (
      accepted.includes("save") &&
      !run.steps.some(
        (step, i) =>
          step.module === row.module &&
          step.flow === row.flow &&
          step.executed &&
          step.submitted &&
          step.businessActionKey &&
          update.evidenceIds.some(
            (id: string) => run.captureIds.indexOf(id) > i,
          ),
      )
    ) {
      accepted.splice(accepted.indexOf("save"), 1);
      warnings.push(
        `${row.module}/${row.flow} 保存缺少同流程的执行及后续观察依据，保持未验证`,
      );
    }
    // Each update replaces the assessment so later contradictions can revoke coverage.
    row.checks = accepted;
    row.evidenceIds = [...new Set<string>(update.evidenceIds)];
    row.detail = update.detail;
    row.limitation = update.limitation;
  }
  return warnings;
}
export function missingChecks(row: DiscoveryCoverage) {
  return checks.filter((c) => !row.checks.includes(c));
}
export function unfinished(run: DiscoveryRun) {
  return (run.coverage ?? []).filter((row) => missingChecks(row).length);
}
export function needsMoreExploration(run: DiscoveryRun) {
  return unfinished(run).some((row) => !row.limitation.trim());
}
export function coverageMarkdown(run: DiscoveryRun) {
  if (!run.coverage?.length)
    return "## 新建与编辑体验清单\n\n本轮未建立覆盖清单，不代表相关流程已体验。";
  return (
    "## 新建与编辑体验清单\n\n以下为基于页面依据的模型评估；保存结果另核对执行与后续观察记录。校验约束已观察不等于已触发页面校验提示。\n\n" +
    run.coverage
      .map((row) => {
        const missing = missingChecks(row);
        return (
          `### ${row.module} · ${row.flow === "create" ? "新建" : "编辑"}（${missing.length ? "未完整覆盖" : "清单已覆盖"}）\n\n` +
          checks
            .map(
              (c) =>
                `- [${row.checks.includes(c) ? "x" : " "}] ${checkNames[c]}`,
            )
            .join("\n") +
          `\n\n观察：${row.detail.slice(0, 600) || "尚未确认"}\n\n限制：${row.limitation || (missing.length ? "尚有遗漏；可能因预算或中断停止，请继续核对。" : "本清单不代表全部异常分支已覆盖。")}\n\n依据：${row.evidenceIds.slice(0, 6).join("、") || "暂无"}`
        );
      })
      .join("\n\n")
  );
}

export const depthInstructions = `深度体验默认包括真实存在的新建、编辑、查询和模块特有交互；不要强行为首页等模块创造新建编辑流程。字段、回填、校验、取消和保存结果作为具体功能的验证角度，不是每个模块固定十项。编辑优先使用本轮测试数据；无数据则记录条件。业务提交仍需确认，删除不属于默认体验。返回module为稳定业务模块名，flow为下一动作所属create/edit/browse。旧coverage字段可兼容但不作为动态功能进度。`;
