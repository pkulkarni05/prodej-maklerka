// netlify/functions/captureSalesFinance.ts
// Behavior:
// - applicant_id is OPTIONAL. If missing, we look up by email (lowercased), then by phone.
// - If still not found, we CREATE a new applicant and proceed.
// - For existing applicants, if identity fields change (full_name/email/phone), we log to applicant_identity_changes.
// - Upserts sales_inquiries for (applicant_id, property_id).
//
// IMPORTANT: This version expects a single "full_name" from the UI (like your rental form).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Request JSON:
// {
//   "property_code": "077-NP09999",
//   "applicant_id": "uuid" | null,            // optional
//   "full_name": "Jana Bodáková",             // required
//   "email": "jana@example.com",              // required
//   "phone": "+420777111222",                 // required
//   "gdpr_consent": true,                     // required
//   "financing_method": "Hypotékou" | null,
//   "own_funds_pct": 20 | null,
//   "mortgage_pct": 80 | null,
//   "has_advisor": "Ano" | "Ne" | "Ne, uvítal/a bych doporučení na spolehlivého specialistu" | null,
//   "mortgage_progress": "...stage..." | null,
//   "tied_to_sale": true | false | null,
//   "buyer_notes": "..." | null,
//   "utm_source": null, "utm_medium": null, "utm_campaign": null
// }
//
// Success Response JSON (200):
// {
//   "ok": true,
//   "property_id": "uuid",
//   "applicant_id": "uuid",
//   "sales_inquiry_id": "uuid",
//   "identity_changed": false,
//   "created_new_applicant": true
// }

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, rateLimitHeaders } from "./utils/rateLimit";
import { bodyTooLarge, getClientIp } from "./utils/request";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

type Body = {
  property_code?: string;
  applicant_id?: string | null;

  // Single name field expected from UI
  full_name?: string;
  email?: string;
  phone?: string;

  gdpr_consent?: boolean;

  financing_method?: string | null;
  own_funds_pct?: number | null;
  mortgage_pct?: number | null;
  has_advisor?: string | null;
  mortgage_progress?: string | null;
  tied_to_sale?: boolean | null;
  buyer_notes?: string | null;

  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }
    if (!event.body) {
      return json(400, { ok: false, error: "Missing request body" });
    }
    if (bodyTooLarge(event, 50_000)) {
      return json(413, { ok: false, error: "Request too large" });
    }

    // Basic rate limiting (best-effort)
    const ip = getClientIp(event);
    const rlIp = rateLimit({
      key: `captureSalesFinance:ip:${ip}`,
      max: 30,
      windowMs: 60 * 60 * 1000,
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

    const body: Body = JSON.parse(event.body);

    // --- Basic validation ---
    if (!body.property_code) {
      return json(400, { ok: false, error: "property_code is required" });
    }
    if (String(body.property_code).length > 64) {
      return json(400, { ok: false, error: "property_code too long" }, rateLimitHeaders(rlIp));
    }
    const fullName = String(body.full_name ?? "").trim();
    if (!fullName) {
      return json(400, { ok: false, error: "full_name is required" });
    }
    if (fullName.length > 200) {
      return json(400, { ok: false, error: "full_name too long" }, rateLimitHeaders(rlIp));
    }
    if (!body.email || !body.phone) {
      return json(400, { ok: false, error: "email and phone are required" });
    }
    if (String(body.email).length > 254 || String(body.phone).length > 40) {
      return json(400, { ok: false, error: "Invalid email/phone" }, rateLimitHeaders(rlIp));
    }
    if (body.gdpr_consent !== true) {
      return json(400, { ok: false, error: "GDPR consent must be accepted" });
    }

    const own = numberOrNull(body.own_funds_pct);
    const mort = numberOrNull(body.mortgage_pct);
    if (own !== null && (own < 0 || own > 100)) {
      return json(400, {
        ok: false,
        error: "own_funds_pct must be between 0 and 100",
      });
    }
    if (mort !== null && (mort < 0 || mort > 100)) {
      return json(400, {
        ok: false,
        error: "mortgage_pct must be between 0 and 100",
      });
    }
    if (own !== null && mort !== null && own + mort > 100) {
      return json(400, {
        ok: false,
        error: "Sum of own_funds_pct and mortgage_pct must be ≤ 100",
      });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // --- Resolve property ---
    const { data: property, error: propErr } = await supabase
      .from("properties")
      .select("id, property_code, business_type, status")
      .eq("property_code", body.property_code)
      .single();

    if (propErr || !property) {
      console.error("Property lookup error:", propErr?.message);
      return json(404, { ok: false, error: "Property not found" });
    }

    const bt = String(property.business_type || "").toLowerCase();
    if (bt !== "sell" && bt !== "prodej") {
      return json(400, { ok: false, error: "Property is not a sales listing" });
    }
    if (property.status !== "available") {
      return json(409, { ok: false, error: "Property is not available" });
    }

    const property_id = property.id;

    // --- Resolve or create applicant ---
    const emailLc = String(body.email).trim().toLowerCase();
    const phoneRaw = String(body.phone).trim();

    let resolvedApplicantId = body.applicant_id ?? null;
    let existingApplicant: {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
      agreed_to_gdpr: boolean | null;
    } | null = null;
    let isNewApplicant = false;

    if (!resolvedApplicantId) {
      // Lookup by email (preferred)
      const byEmail = await supabase
        .from("applicants")
        .select("id, full_name, email, phone, agreed_to_gdpr")
        .ilike("email", emailLc) // case-insensitive
        .maybeSingle();

      if (!byEmail.error && byEmail.data) {
        existingApplicant = byEmail.data;
        resolvedApplicantId = byEmail.data.id;
      } else if (!resolvedApplicantId && phoneRaw) {
        // Lookup by phone if email not found
        const byPhone = await supabase
          .from("applicants")
          .select("id, full_name, email, phone, agreed_to_gdpr")
          .eq("phone", phoneRaw)
          .maybeSingle();

        if (!byPhone.error && byPhone.data) {
          existingApplicant = byPhone.data;
          resolvedApplicantId = byPhone.data.id;
        }
      }
    }

    if (!resolvedApplicantId) {
      // Create new applicant
      const { data: created, error: createErr } = await supabase
        .from("applicants")
        .insert({
          full_name: fullName,
          email: body.email,
          phone: body.phone,
          agreed_to_gdpr: true, // they checked GDPR
        })
        .select("id, full_name, email, phone, agreed_to_gdpr")
        .single();

      if (createErr || !created) {
        console.error("Create applicant error:", createErr?.message);
        return json(500, { ok: false, error: "Failed to create applicant" });
      }
      resolvedApplicantId = created.id;
      existingApplicant = created;
      isNewApplicant = true;
    } else if (!existingApplicant) {
      // If id was provided or found but we don't have full row yet, fetch it
      const { data: fetched, error: applErr } = await supabase
        .from("applicants")
        .select("id, full_name, email, phone, agreed_to_gdpr")
        .eq("id", resolvedApplicantId)
        .single();
      if (applErr || !fetched) {
        console.error("Fetch applicant error:", applErr?.message);
        return json(404, { ok: false, error: "Applicant not found" });
      }
      existingApplicant = fetched;
    }

    // --- Identity change detection (only if NOT newly created) ---
    let identityChanged = false;
    if (!isNewApplicant) {
      identityChanged =
        norm(existingApplicant.full_name) !== norm(fullName) ||
        norm(existingApplicant.email) !== norm(body.email) ||
        norm(existingApplicant.phone) !== norm(body.phone);

      if (identityChanged) {
        // NOTE: applicant_identity_changes has first/last columns in your earlier draft.
        // We'll store the full name into *_first_name and keep *_last_name null to avoid schema churn.
        const { error: changeErr } = await supabase
          .from("applicant_identity_changes")
          .insert({
            applicant_id: resolvedApplicantId,
            property_id,
            changed_by: "buyer_form",
            old_first_name: existingApplicant.full_name, // we put full name here
            old_last_name: null,
            old_email: existingApplicant.email,
            old_phone: existingApplicant.phone,
            new_first_name: fullName, // full name again
            new_last_name: null,
            new_email: body.email,
            new_phone: body.phone,
          });
        if (changeErr) {
          console.warn("Failed to write identity change:", changeErr.message);
        }
      }
    }

    // --- Update applicant authoritative fields (both new and existing) ---
    {
      const { error: updErr } = await supabase
        .from("applicants")
        .update({
          full_name: fullName,
          email: body.email,
          phone: body.phone,
          agreed_to_gdpr: true, // keep true if they accepted now
        })
        .eq("id", resolvedApplicantId);
      if (updErr) {
        console.error("Update applicant error:", updErr.message);
        return json(500, { ok: false, error: "Failed to update applicant" });
      }
    }

    // --- Upsert sales_inquiries for (applicant_id, property_id) ---
    const { data: existingInq, error: findErr } = await supabase
      .from("sales_inquiries")
      .select("id")
      .eq("applicant_id", resolvedApplicantId)
      .eq("property_id", property_id)
      .maybeSingle();

    const payload = {
      applicant_id: resolvedApplicantId,
      property_id,
      financing_method: body.financing_method ?? null,
      own_funds_pct: own,
      mortgage_pct: mort,
      has_advisor: body.has_advisor ?? null,
      mortgage_progress: body.mortgage_progress ?? null,
      tied_to_sale: body.tied_to_sale ?? null,
      buyer_notes: body.buyer_notes ?? null,
      form_submitted_at: new Date().toISOString(),
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
    };

    let salesInquiryId: string;

    if (!findErr && existingInq?.id) {
      const { data: upd, error: updInqErr } = await supabase
        .from("sales_inquiries")
        .update(payload)
        .eq("id", existingInq.id)
        .select("id")
        .single();
      if (updInqErr || !upd) {
        console.error("Update sales inquiry error:", updInqErr?.message);
        return json(500, {
          ok: false,
          error: "Failed to update sales inquiry",
        });
      }
      salesInquiryId = upd.id;
    } else {
      const { data: ins, error: insInqErr } = await supabase
        .from("sales_inquiries")
        .insert(payload)
        .select("id")
        .single();
      if (insInqErr || !ins) {
        console.error("Insert sales inquiry error:", insInqErr?.message);
        return json(500, {
          ok: false,
          error: "Failed to create sales inquiry",
        });
      }
      salesInquiryId = ins.id;
    }

    return json(200, {
      ok: true,
      property_id,
      applicant_id: resolvedApplicantId,
      sales_inquiry_id: salesInquiryId,
      identity_changed: identityChanged,
      created_new_applicant: isNewApplicant,
    }, rateLimitHeaders(rlIp));
  } catch (e: any) {
    console.error("captureSalesFinance fatal error:", e?.message || e);
    return json(500, { ok: false, error: "Internal server error" });
  }
};

// --- helpers ---
function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}
function norm(v: unknown): string {
  return String(v ?? "").trim();
}
function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : null;
}
