import type { DiscoveryRun } from "../contracts/discovery.js";
import { verifiedFeature } from "./features.js";
export function discoveryProgress(run: DiscoveryRun) {
  const names = [
    ...new Set([
      ...(run.modules ?? []).map((m) => m.name),
      ...(run.features ?? []).map((f) => f.module),
      ...(run.coverage ?? []).map((c) => c.module),
    ]),
  ];
  const modules = names.map((name) => {
    const features = (run.features ?? []).filter((f) => f.module === name);
    const done = features.filter((f) => verifiedFeature(run, f)).length;
    return {
      name,
      features,
      done,
      total: features.length,
      percent: features.length ? Math.floor((done / features.length) * 100) : 0,
      record: run.modules?.find((m) => m.name === name),
    };
  });
  const done = modules.reduce((n, m) => n + m.done, 0),
    total = modules.reduce((n, m) => n + m.total, 0);
  const used = run.captureIds.length - (run.roundStart ?? 0),
    budget = run.budget - (run.roundStart ?? 0);
  return {
    modules,
    done,
    total,
    percent: total ? Math.floor((done / total) * 100) : 0,
    used,
    budget,
    budgetPercent: budget
      ? Math.min(100, Math.round((used / budget) * 100))
      : 0,
  };
}
