import { test } from "node:test";
import assert from "node:assert/strict";
import { latestDescendant } from "../src/prototypes/lineage.js";
import type { PrototypeVersion } from "../src/contracts/workbench.js";
test("supplement uses current edited descendant, not unrelated latest prototype", () => {
  const versions = [
    { id: "other", baselineId: null },
    { id: "edited", baselineId: "edit1" },
    { id: "edit1", baselineId: "original" },
    { id: "original", baselineId: null },
  ] as PrototypeVersion[];
  assert.equal(latestDescendant(versions, "original"), "edited");
  assert.equal(latestDescendant(versions, "missing"), "missing");
});
