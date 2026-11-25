import type { DiscoveryRun, DiscoveryCheck } from "../contracts/discovery.js";
import { checks } from "./coverage.js";
export function discoveryProgress(run: DiscoveryRun) {
  const names = [
    ...new Set([
      ...(run.modules ?? []).map((m) => m.name),
      ...(run.coverage ?? []).map((c) => c.module),
    ]),
  ];
  const modules = names.map((name) => {
    const flows = (["create", "edit"] as const).map((flow) => {
      const row = run.coverage?.find(
        (c) => c.module === name && c.flow === flow,
      );
      const validated = checks.filter(
        (c) =>
          row?.checks.includes(c) &&
          row.evidenceIds.some((id) => run.captureIds.includes(id)),
      );
      return {
        flow,
        done: validated.length,
        total: checks.length,
        percent: validated.length * 20,
        checks: checks.map((check) => ({
          check,
          percent: validated.includes(check as DiscoveryCheck) ? 100 : 0,
        })),
        limitation: row?.limitation ?? "",
      };
    });
    const done = flows.reduce((n, f) => n + f.done, 0),
      record = run.modules?.find((m) => m.name === name);
    return {
      name,
      flows,
      done,
      total: 10,
      percent: done * 10,
      summaryPercent:
        record?.signature &&
        !record.error &&
        ["summarized", "partial"].includes(record.state)
          ? 100
          : 0,
    };
  });
  const done = modules.reduce((n, m) => n + m.done, 0),
    total = modules.length * 10;
  const used = run.captureIds.length - (run.roundStart ?? 0),
    budget = run.budget - (run.roundStart ?? 0);
  return {
    modules,
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    used,
    budget,
    budgetPercent: budget
      ? Math.min(100, Math.round((used / budget) * 100))
      : 0,
  };
}
