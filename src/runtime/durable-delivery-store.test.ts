import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  completeDelivery,
  pendingDeliveries,
  persistDelivery,
  recordDeliveryFailure,
} from "./durable-delivery-store.js";

async function withStore(run: (dir: string) => Promise<void>): Promise<void> {
  const previous = process.env.LINEAR_EVENT_STORE_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "linear-delivery-test-"));
  process.env.LINEAR_EVENT_STORE_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (previous === undefined) delete process.env.LINEAR_EVENT_STORE_DIR;
    else process.env.LINEAR_EVENT_STORE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("durably queues delivery before work and recovers it after a cold read", async () => {
  await withStore(async (dir) => {
    const payload = { type: "AgentSessionEvent", id: "event-1" };
    await persistDelivery("stable-event", payload, "cid-1");
    process.env.LINEAR_EVENT_STORE_DIR = dir;
    const recovered = await pendingDeliveries();
    assert.equal(recovered.length, 1);
    assert.deepEqual(recovered[0]?.payload, payload);
    assert.equal(recovered[0]?.correlationId, "cid-1");
  });
});

test("retry state survives restart and completed identities stay deduplicated", async () => {
  await withStore(async () => {
    const payload = { type: "AgentSessionEvent", id: "event-2" };
    await persistDelivery("stable-event", payload, "cid-2");
    const [delivery] = await pendingDeliveries();
    assert.ok(delivery);
    await recordDeliveryFailure(delivery);
    const [retry] = await pendingDeliveries();
    assert.equal(retry?.attempts, 1);
    assert.ok(retry);
    await completeDelivery(retry);
    await persistDelivery("stable-event", { type: "changed" }, "cid-retry");
    assert.deepEqual(await pendingDeliveries(), []);
  });
});
