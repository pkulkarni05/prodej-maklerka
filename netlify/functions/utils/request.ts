// netlify/functions/utils/request.ts
import type { HandlerEvent } from "@netlify/functions";

export function getClientIp(event: HandlerEvent): string {
  const h = event.headers || {};
  const pick =
    (h["x-nf-client-connection-ip"] as string) ||
    (h["x-forwarded-for"] as string) ||
    (h["cf-connecting-ip"] as string) ||
    (h["client-ip"] as string) ||
    (h["x-real-ip"] as string) ||
    "";

  // x-forwarded-for can be a list
  const ip = String(pick).split(",")[0].trim();
  return ip || "unknown";
}

export function bodyTooLarge(event: HandlerEvent, maxBytes: number): boolean {
  const b = event.body || "";
  // Netlify gives body as string; length is char count, close enough for abuse guard
  return b.length > maxBytes;
}

