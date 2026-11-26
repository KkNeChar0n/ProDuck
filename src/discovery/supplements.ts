import type { DiscoveryRun } from "../contracts/discovery.js";
export function supplementNeeds(run: DiscoveryRun) {
  const plan =
    run.supplementPlan ??
    (run.modules ?? []).flatMap((m) => {
      const hasPage =
        !!m.representativeIds?.length ||
        run.steps.some((s) => s.module === m.name);
      const notes = [...new Set(m.captureNotes ?? [])];
      if (!hasPage) notes.unshift("尚未采集代表页面，请补充模块主页面");
      return notes.map((description) => ({
        id: `${m.name}::${description}`,
        module: m.name,
        description,
      }));
    });
  return plan.map((need) => ({
    ...need,
    captureId: run.supplements?.find((s) => s.needId === need.id)?.captureId,
  }));
}
export function overviewCounts(run: DiscoveryRun) {
  const modules = run.modules ?? [];
  const collected = modules.filter(
    (m) =>
      m.representativeIds?.length || run.steps.some((s) => s.module === m.name),
  ).length;
  const used =
      run.roundSteps ??
      Math.max(0, run.captureIds.length - (run.roundStart ?? 0)),
    total = Math.max(0, run.budget - (run.roundStart ?? 0));
  return {
    used,
    total,
    remaining: Math.max(0, total - used),
    collected,
    uncollected: modules.length - collected,
    summarized: modules.filter((m) => !!m.markdown).length,
    needs: supplementNeeds(run).filter((n) => !n.captureId).length,
  };
}
