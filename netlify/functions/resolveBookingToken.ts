// netlify/functions/resolveBookingToken.ts
// Purpose:
// - Resolve a booking token (?token=...) into { applicant_id, property_id } for SALES booking flow.
// - This avoids exposing applicant UUIDs in public booking links.
//
// Request (GET):
//   /.netlify/functions/resolveBookingToken?token=<token>&property_code=<077-NP12345>
//
// Response (200):
//   { ok: true, token_id: "...", applicant_id: "...", property_id: "...", property_code: "..." }
//
// Errors:
// - 400 missing params
// - 401 invalid token / mismatch
// - 409 property not available / not sales
// - 500 server

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: vt, error: vtErr } = await supabase
      .from("viewing_tokens")
      .select("id, token, applicant_id, property_id, used, created_at")
      .eq("token", token)
      .maybeSingle();

    if (vtErr || !vt) {
      return json(401, { ok: false, error: "Invalid token" });
    }

    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .select("id, property_code, business_type, status")
      .eq("id", vt.property_id)
      .single();

    if (propErr || !prop) {
      return json(401, { ok: false, error: "Invalid token (property not found)" });
    }

    const bt = String(prop.business_type || "").toLowerCase();
    const isSales = bt === "sell" || bt === "prodej" || bt === "sale";
    if (!isSales) {
      return json(409, { ok: false, error: "Property is not a sales listing" });
    }
    if (String(prop.status || "") !== "available") {
      return json(409, { ok: false, error: "Property is not available" });
    }

    const propCodeDb = String(prop.property_code || "").trim();
    if (propCodeDb !== propertyCode) {
      return json(401, { ok: false, error: "Token does not match property" });
    }

    return json(200, {
      ok: true,
      token_id: String(vt.id),
      applicant_id: String(vt.applicant_id),
      property_id: String(vt.property_id),
      property_code: propCodeDb,
      // NOTE: we intentionally do not return vt.token or any applicant PII here
    });
  } catch (e: any) {
    console.error("resolveBookingToken error:", e?.message || e);
    return json(500, { ok: false, error: "Internal server error" });
  }
};

function json(status: number, body: any) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

