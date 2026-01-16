// netlify/functions/getBookingPageData.ts
// Purpose:
// - Provide all data needed for the SALES booking page without any browser -> Supabase access.
// - Requires booking token + property_code.
//
// Request (GET):
//   /.netlify/functions/getBookingPageData?token=<booking_token>&property_code=<077-NP12345>
//
// Response (200):
// {
//   ok: true,
//   existing_viewing_time: "2026-01-16T..." | null,
//   slots: [{ id, slot_start, slot_end }]
// }

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { rateLimit, rateLimitHeaders } from "./utils/rateLimit";
import { getClientIp } from "./utils/request";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Europe/Prague");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Missing Supabase env vars" });
    }

    const token = String(event.queryStringParameters?.token || "").trim();
    const propertyCode = String(
      event.queryStringParameters?.property_code || ""
    ).trim();

    if (!token) return json(400, { ok: false, error: "Missing token" });
    if (!propertyCode)
      return json(400, { ok: false, error: "Missing property_code" });
    if (token.length > 256)
      return json(400, { ok: false, error: "Token too long" });
    if (propertyCode.length > 64)
      return json(400, { ok: false, error: "property_code too long" });

    // Best-effort rate limiting
    const ip = getClientIp(event);
    const rlIp = rateLimit({
      key: `getBookingPageData:ip:${ip}`,
      max: 120,
      windowMs: 10 * 60 * 1000,
    });
    if (!rlIp.allowed) {
      return json(
        429,
        { ok: false, error: "Rate limit exceeded" },
        {
          ...rateLimitHeaders(rlIp),
          "Retry-After": String(Math.ceil(rlIp.resetMs / 1000)),
        }
      );
    }
    const rlTok = rateLimit({
      key: `getBookingPageData:tok:${token}`,
      max: 120,
      windowMs: 10 * 60 * 1000,
    });
    if (!rlTok.allowed) {
      return json(
        429,
        { ok: false, error: "Rate limit exceeded" },
        {
          ...rateLimitHeaders(rlTok),
          "Retry-After": String(Math.ceil(rlTok.resetMs / 1000)),
        }
      );
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve token -> applicant_id + property_id
    const { data: vt, error: vtErr } = await sb
      .from("viewing_tokens")
      .select("applicant_id, property_id")
      .eq("token", token)
      .maybeSingle();
    if (vtErr || !vt?.applicant_id || !vt?.property_id) {
      return json(
        401,
        { ok: false, error: "Invalid token" },
        { ...rateLimitHeaders(rlIp), "Cache-Control": "no-store" }
      );
    }

    // Verify property matches code + is sales + available
    const { data: prop, error: propErr } = await sb
      .from("properties")
      .select("id, property_code, business_type, status")
      .eq("id", vt.property_id)
      .single();
    if (propErr || !prop) {
      return json(401, { ok: false, error: "Invalid token (property missing)" });
    }
    if (String(prop.property_code || "").trim() !== propertyCode) {
      return json(401, { ok: false, error: "Token does not match property" });
    }
    const bt = String(prop.business_type || "").toLowerCase();
    if (!(bt === "sell" || bt === "prodej" || bt === "sale")) {
      return json(409, { ok: false, error: "Property is not a sales listing" });
    }
    if (String(prop.status || "") !== "available") {
      return json(409, { ok: false, error: "Property is not available" });
    }

    // Existing booking banner (if any)
    const { data: inq } = await sb
      .from("sales_inquiries")
      .select("viewing_time, viewing_time_text")
      .eq("applicant_id", vt.applicant_id)
      .eq("property_id", vt.property_id)
      .maybeSingle();

    const existingViewingTime =
      (inq as any)?.viewing_time_text ||
      (inq as any)?.viewing_time ||
      null;

    // Available future slots only (Prague)
    const nowMs = dayjs().tz("Europe/Prague").valueOf();
    const { data: slots, error: slotsErr } = await sb
      .from("viewings")
      .select("id, slot_start, slot_end")
      .eq("property_id", vt.property_id)
      .eq("status", "available")
      .order("slot_start", { ascending: true });
    if (slotsErr) {
      return json(500, { ok: false, error: "Failed to load slots" });
    }

    const filtered = (slots || []).filter((s: any) => {
      const ms = dayjs.tz(s.slot_start, "Europe/Prague").valueOf();
      return ms >= nowMs;
    });

    return json(
      200,
      {
        ok: true,
        existing_viewing_time: existingViewingTime,
        slots: filtered,
      },
      { ...rateLimitHeaders(rlIp), "Cache-Control": "no-store" }
    );
  } catch (e: any) {
    console.error("getBookingPageData error:", e?.message || e);
    return json(500, { ok: false, error: "Internal server error" });
  }
};

function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

