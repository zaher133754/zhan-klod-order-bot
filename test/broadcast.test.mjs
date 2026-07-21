import assert from "node:assert/strict";
import test from "node:test";
import { broadcast } from "../src/broadcast.mjs";

test("broadcast delivers an order to every unique subscriber", async () => {
  const received = [];

  const result = await broadcast([101, "202", "101"], async (chatId) => {
    received.push(chatId);
  });

  assert.deepEqual(received.sort(), ["101", "202"]);
  assert.deepEqual(result, { delivered: 2, failures: [] });
});

test("one unavailable subscriber does not prevent delivery to the others", async () => {
  const received = [];

  const result = await broadcast(["101", "202", "303"], async (chatId) => {
    if (chatId === "202") throw new Error("bot was blocked");
    received.push(chatId);
  });

  assert.deepEqual(received.sort(), ["101", "303"]);
  assert.equal(result.delivered, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].chatId, "202");
  assert.match(result.failures[0].reason.message, /blocked/);
});
