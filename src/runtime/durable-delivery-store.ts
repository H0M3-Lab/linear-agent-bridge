import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface DurableDelivery {
  id: string;
  payload: Record<string, unknown>;
  correlationId: string;
  attempts: number;
  status: "pending" | "complete";
  receivedAt: string;
  updatedAt: string;
}

const writes = new Map<string, Promise<void>>();

export function deliveryId(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}

export function deliveryStoreDir(): string {
  return process.env.LINEAR_EVENT_STORE_DIR?.trim() || "/var/lib/linear-bridge/events";
}

export async function persistDelivery(
  id: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  const file = fileFor(id);
  await serialize(file, async () => {
    try {
      await fs.access(file);
      return; // Already accepted, whether queued or completed.
    } catch {
      // First delivery for this stable identity.
    }
    await writeAtomic(file, {
      id,
      payload,
      correlationId,
      attempts: 0,
      status: "pending",
      receivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function pendingDeliveries(): Promise<DurableDelivery[]> {
  const dir = deliveryStoreDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const deliveries: DurableDelivery[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8")) as DurableDelivery;
      if (value.status === "pending" && value.payload && typeof value.payload === "object") {
        deliveries.push(value);
      }
    } catch {
      // Leave malformed files in place for operator inspection; never discard work silently.
    }
  }
  return deliveries.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export async function completeDelivery(delivery: DurableDelivery): Promise<void> {
  await writeRecord(delivery, "complete");
}

export async function recordDeliveryFailure(delivery: DurableDelivery): Promise<void> {
  delivery.attempts += 1;
  await writeRecord(delivery, "pending");
}

async function writeRecord(delivery: DurableDelivery, status: DurableDelivery["status"]): Promise<void> {
  const next: DurableDelivery = {
    ...delivery,
    status,
    updatedAt: new Date().toISOString(),
    ...(status === "complete" ? { payload: {} } : {}),
  };
  await writeAtomic(fileFor(delivery.id), next);
}

function fileFor(id: string): string {
  return path.join(deliveryStoreDir(), `${deliveryId(id)}.json`);
}

async function writeAtomic(file: string, value: DurableDelivery): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600);
}

function serialize(file: string, operation: () => Promise<void>): Promise<void> {
  const prior = writes.get(file) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(operation);
  writes.set(file, next);
  return next.finally(() => {
    if (writes.get(file) === next) writes.delete(file);
  });
}
