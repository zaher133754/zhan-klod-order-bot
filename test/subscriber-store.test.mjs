import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SubscriberStore } from "../src/subscriber-store.mjs";

test("subscriber chat ids survive a restart and are not duplicated", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-subscribers-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "data", "subscribers.json");
  const store = new SubscriberStore(filePath);

  assert.equal(await store.add(12345), true);
  assert.equal(await store.add("12345"), false);
  assert.equal(await store.add(-98765), true);

  const restoredStore = new SubscriberStore(filePath);
  await restoredStore.load();

  assert.deepEqual(restoredStore.values(), ["12345", "-98765"]);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
    chatIds: ["12345", "-98765"]
  });
});

test("missing subscribers file starts with an empty list", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-subscribers-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new SubscriberStore(join(directory, "missing.json"));

  await store.load();

  assert.deepEqual(store.values(), []);
});
