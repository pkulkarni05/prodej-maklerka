import type { HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { getClientIp } from "./request";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

export type AuditEventType =
  | "booking_page_loaded"
  | "booking_token_resolved"
  | "booking_slot_booked"
  | "finance_context_resolved"
  | "finance_prefill_resolved"
  | "finance_submitted";

export type AuditWrite = {
  event_type: AuditEventType;
  applicant_id?: string | null;
  property_id?: string | null;
  viewing_token_id?: string | null;
  token_to_hash?: string | null; // never store raw token, only hash prefix
  meta?: Record<string, any> | null;
};

function tokenHashPrefix(token: string, bytes = 10): string {
  // 10 bytes -> 20 hex chars (short, non-reversible)
  const hex = crypto.createHash("sha256").update(token).digest("hex");
  return hex.slice(0, bytes * 2);
}

export async function writeAuditEvent(
  event: HandlerEvent,
  data: AuditWrite
): Promise<void> {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

    const clientIp = getClientIp(event);
    const userAgent = String(event.headers?.["user-agent"] || "").slice(0, 300);

    const tokenHash =
      data.token_to_hash && data.token_to_hash.trim()
        ? tokenHashPrefix(data.token_to_hash.trim())
        : null;

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const payload = {
      event_type: data.event_type,
      applicant_id: data.applicant_id ?? null,
      property_id: data.property_id ?? null,
      viewing_token_id: data.viewing_token_id ?? null,
      client_ip: clientIp || null,
      user_agent: userAgent || null,
      token_hash_prefix: tokenHash,
      meta: data.meta ?? null,
    };

    const { error } = await sb.from("audit_events").insert(payload);
    if (error) {
      // best-effort: do not break the main request flow
      console.warn("audit_events insert failed:", error.message);
    }
  } catch (e: any) {
    // best-effort
    console.warn("writeAuditEvent failed:", e?.message || e);
  }
}

