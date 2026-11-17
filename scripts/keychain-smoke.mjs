import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  MacKeychain,
  newCredentialReference,
} from "../dist/integrations/credentials.js";
const store = new MacKeychain(resolve("dist/native/produck-keychain"));
const ref = newCredentialReference();
try {
  await store.set(ref, "produck-synthetic-test-value");
  assert.equal(await store.get(ref), "produck-synthetic-test-value");
  await store.set(ref, "produck-updated-test-value");
  assert.equal(await store.get(ref), "produck-updated-test-value");
  await store.delete(ref);
  assert.equal(await store.get(ref), null);
  console.log(
    "PASS: macOS Keychain create, read, update, delete; secret passed through stdin only",
  );
} finally {
  await store.delete(ref);
}
