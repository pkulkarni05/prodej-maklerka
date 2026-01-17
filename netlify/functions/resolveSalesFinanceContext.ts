// netlify/functions/resolveSalesFinanceContext.ts
// Purpose:
// - Provide remember-safe context for the SALES finance form without any browser -> Supabase access.
// - Requires either:
//    A) finance JWT (?token=...) signed with FINANCE_LINK_SECRET, OR
//    B) booking token (?booking_token=...) from viewing_tokens.token.
//
// Request (GET):
//   /.netlify/functions/resolveSalesFinanceContext?property_code=<CODE>&token=<JWT>
//   or
//   /.netlify/functions/resolveSalesFinanceContext?property_code=<CODE>&booking_token=<TOKEN>
//
// Response (200):
// {
//   ok: true,
//   applicant: { id, full_name, email, phone },
//   property: { id, property_code, address, property_configuration, business_type, status }
// }

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import { rateLimit, rateLimitHeaders } from "./utils/rateLimit";
import { getClientIp } from "./utils/request";
import { writeAuditEvent } from "./utils/audit";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCE_LINK_SECRET } =
  process.env;

type Claims = {
  purpose?: string;
  applicant_id?: string;
  property_id?: string;
  property_code?: string;
  iat?: number;
  exp?: number;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Missing Supabase env vars" });
    }

    const propertyCode = String(
      event.queryStringParameters?.property_code || ""
    ).trim();
    const financeToken = String(event.queryStringParameters?.token || "").trim();
    const bookingToken = String(
      event.queryStringParameters?.booking_token || ""
    ).trim();

    if (!propertyCode)
      return json(400, { ok: false, error: "Missing property_code" });
    if (propertyCode.length > 64)
      return json(400, { ok: false, error: "property_code too long" });
    if (!financeToken && !bookingToken) {
      return json(401, { ok: false, error: "Missing token or booking_token" });
    }

    // rate limit (best-effort)
    const ip = getClientIp(event);
    const rlIp = rateLimit({
      key: `resolveSalesFinanceContext:ip:${ip}`,
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

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let applicantId: string | null = null;
    let propertyId: string | null = null;

    if (financeToken) {
      if (!FINANCE_LINK_SECRET) {
        return json(500, { ok: false, error: "Missing FINANCE_LINK_SECRET" });
      }

      let claims: Claims;
      try {
        claims = jwt.verify(financeToken, FINANCE_LINK_SECRET, {
          algorithms: ["HS256"],
        }) as Claims;
      } catch {
        void writeAuditEvent(event, {
          event_type: "finance_context_resolved",
          token_to_hash: financeToken,
          meta: { ok: false, reason: "invalid_finance_token", property_code: propertyCode },
        });
        return json(401, { ok: false, error: "Invalid or expired token" });
      }

      if (claims.purpose !== "finance_form_v1") {
        return json(401, { ok: false, error: "Invalid token purpose" });
      }
      if (!claims.applicant_id || !claims.property_id || !claims.property_code) {
        return json(401, { ok: false, error: "Incomplete token" });
      }
      if (String(claims.property_code).trim() !== propertyCode) {
        void writeAuditEvent(event, {
          event_type: "finance_context_resolved",
          token_to_hash: financeToken,
          meta: { ok: false, reason: "property_mismatch", property_code: propertyCode },
        });
        return json(401, { ok: false, error: "Token does not match property" });
      }
      applicantId = String(claims.applicant_id);
      propertyId = String(claims.property_id);
    } else if (bookingToken) {
      if (bookingToken.length > 256) {
        return json(400, { ok: false, error: "booking_token too long" });
      }
      const { data: vt, error: vtErr } = await sb
        .from("viewing_tokens")
        .select("applicant_id, property_id")
        .eq("token", bookingToken)
        .maybeSingle();
      if (vtErr || !vt?.applicant_id || !vt?.property_id) {
        void writeAuditEvent(event, {
          event_type: "finance_context_resolved",
          token_to_hash: bookingToken,
          meta: { ok: false, reason: "invalid_booking_token", property_code: propertyCode },
        });
        return json(401, { ok: false, error: "Invalid booking_token" });
      }
      applicantId = String(vt.applicant_id);
      propertyId = String(vt.property_id);
    }

    if (!applicantId || !propertyId) {
      return json(500, { ok: false, error: "Failed to resolve context" });
    }

    const { data: applicant, error: applErr } = await sb
      .from("applicants")
      .select("id, full_name, email, phone")
      .eq("id", applicantId)
      .single();
    if (applErr || !applicant) {
      return json(404, { ok: false, error: "Applicant not found" });
    }

    const { data: property, error: propErr } = await sb
      .from("properties")
      .select(
        "id, property_code, address, property_configuration, business_type, status"
      )
      .eq("id", propertyId)
      .single();
    if (propErr || !property) {
      return json(404, { ok: false, error: "Property not found" });
    }

    // Enforce property_code match + sales listing
    if (String(property.property_code || "").trim() !== propertyCode) {
      void writeAuditEvent(event, {
        event_type: "finance_context_resolved",
        applicant_id: applicantId,
        property_id: propertyId,
        token_to_hash: financeToken || bookingToken,
        meta: { ok: false, reason: "property_mismatch", property_code: propertyCode },
      });
      return json(401, { ok: false, error: "Context does not match property" });
    }
    const bt = String(property.business_type || "").toLowerCase();
    if (!(bt === "sell" || bt === "prodej" || bt === "sale")) {
      void writeAuditEvent(event, {
        event_type: "finance_context_resolved",
        applicant_id: applicantId,
        property_id: propertyId,
        token_to_hash: financeToken || bookingToken,
        meta: { ok: false, reason: "not_sales", property_code: propertyCode },
      });
      return json(409, { ok: false, error: "Property is not a sales listing" });
    }

    void writeAuditEvent(event, {
      event_type: "finance_context_resolved",
      applicant_id: applicantId,
      property_id: propertyId,
      token_to_hash: financeToken || bookingToken,
      meta: { ok: true, property_code: propertyCode },
    });

    return json(
      200,
      {
        ok: true,
        applicant,
        property,
      },
      { ...rateLimitHeaders(rlIp), "Cache-Control": "no-store" }
    );
  } catch (e: any) {
    console.error("resolveSalesFinanceContext error:", e?.message || e);
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

