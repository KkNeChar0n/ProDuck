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

export const depthInstructions = `默认深度体验：每个已识别业务模块都必须主动寻找新建和编辑，不需要用户特别点名。先梳理模块入口，再深入各模块：列表/筛选/详情、新建、编辑。对新建和编辑分别体验 entry（入口）、fields（字段、默认值/编辑回填、联动）、validation（原生约束或实际校验，明确区分）、cancel（修改后取消与结果）、save（确认提交后的结果）。编辑优先使用本轮新建的测试记录或用户指定测试记录；没有适合的数据则标明限制，不自行修改重要真实记录。删除不属于默认体验。用户拒绝提交时记录原因并继续其他流程，不绕过确认。
返回 JSON 另外包含 module（稳定业务模块名，不把新增/编辑弹窗另当模块）、flow（下一动作所属 create/edit/browse）、coverage（对已观察清单的更新数组）。coverage 中 flow 只允许 create 或 edit，不要放入 browse；浏览流程写在 observation 中。每项格式：{"module":"模块名","flow":"create","checks":["entry","fields"],"evidenceIds":["真实采集ID"],"detail":"实际观察的字段与行为","limitation":"尚未覆盖的明确原因，没有阻碍时为空"}。checks 只能列出已观察项；save 只能在同流程业务提交已执行且后续页面证明结果后填写。更新时列出该流程累计已观察项；已知遗漏尚可继续时不能用笼统限制提前结束。找不到入口、权限不足、用户跳过或预算不足均保留未勾选项及原因，不能推断系统不支持该功能。结束前逐模块检查两类流程，不能只浏览列表便结束。`;
