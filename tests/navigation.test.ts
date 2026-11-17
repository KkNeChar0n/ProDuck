import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWebDestination } from "../src/desktop/navigation.js";
test("normalizes HTTPS and allows loopback fixture servers", () => {
  assert.equal(
    parseWebDestination("https://example.com"),
    "https://example.com/",
  );
  assert.equal(
    parseWebDestination("http://127.0.0.1:4173/path"),
    "http://127.0.0.1:4173/path",
  );
});
test("rejects local files, executable schemes, credentials and cleartext remote destinations", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "http://example.com",
    "https://user:secret@example.com",
    "http://localhost.example.com",
  ])
    assert.throws(() => parseWebDestination(url));
});
