import { test } from "node:test";
import assert from "node:assert/strict";
import { MacKeychain, redact } from "../src/integrations/credentials.js";
test("structured logging redacts nested credentials without changing safe metadata", () => {
  const value = redact({
    provider: "example",
    apiToken: "secret",
    nested: { Authorization: "Bearer demo", app_secret: "secret" },
    items: [{ password: "pass" }],
  });
  assert.deepEqual(value, {
    provider: "example",
    apiToken: "[REDACTED]",
    nested: { Authorization: "[REDACTED]", app_secret: "[REDACTED]" },
    items: [{ password: "[REDACTED]" }],
  });
});
test("credential requests reject untrusted references before spawning a helper", async () => {
  await assert.rejects(
    new MacKeychain("/does/not/exist").get("../reference"),
    /凭证引用无效/,
  );
});
