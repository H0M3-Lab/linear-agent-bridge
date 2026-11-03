import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(
  secret: string | undefined,
  signature: string | undefined,
  raw: Buffer,
): boolean {
  if (!secret || !signature) return false;
  const header = Buffer.from(signature, "hex");
  const digest = createHmac("sha256", secret).update(raw).digest();
  if (header.length !== digest.length) return false;
  return timingSafeEqual(digest, header);
}
