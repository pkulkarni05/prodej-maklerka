// File: netlify/functions/bookSlot.ts  (SALES; same method as Rentals)
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import { rateLimit, rateLimitHeaders } from "./utils/rateLimit";
import { bodyTooLarge, getClientIp } from "./utils/request";
import { writeAuditEvent } from "./utils/audit";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (bodyTooLarge(event, 10_000)) {
      return json(413, { ok: false, error: "Request too large" });
    }

    const { slotId, token } = JSON.parse(event.body || "{}") as {
      slotId?: string;
      token?: string;
    };

    if (!slotId || !token) {
      return json(400, { ok: false, error: "Missing slotId or token" });
    }
    if (String(slotId).length > 64 || String(token).length > 256) {
      return json(400, { ok: false, error: "Invalid input" });
    }

    // Basic rate limiting (best-effort)
    const ip = getClientIp(event);
    const rlIp = rateLimit({
      key: `bookSlot:ip:${ip}`,
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
    const rlTok = rateLimit({
      key: `bookSlot:tok:${String(token).trim()}`,
      max: 10,
      windowMs: 60 * 60 * 1000,
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

    // 0) Resolve booking token -> applicant_id + property_id (and validate sales+available)
    const { data: vt, error: vtErr } = await supabase
      .from("viewing_tokens")
      .select("id, applicant_id, property_id, token, used")
      .eq("token", String(token).trim())
      .maybeSingle();

    if (vtErr || !vt?.applicant_id || !vt?.property_id) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        meta: { ok: false, reason: "invalid_token", slot_id: slotId },
      });
      return json(401, { ok: false, error: "Invalid token" }, rateLimitHeaders(rlIp));
    }

    const applicantId = String(vt.applicant_id);
    const tokenPropertyId = String(vt.property_id);

    const { data: tokenProperty, error: tokenPropErr } = await supabase
      .from("properties")
      .select("id, business_type, status")
      .eq("id", tokenPropertyId)
      .single();

    if (tokenPropErr || !tokenProperty) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "token_property_missing", slot_id: slotId },
      });
      return json(401, { ok: false, error: "Invalid token (property missing)" }, rateLimitHeaders(rlIp));
    }

    const bt = String(tokenProperty.business_type || "").toLowerCase();
    if (!(bt === "sell" || bt === "prodej" || bt === "sale")) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "not_sales", slot_id: slotId },
      });
      return json(409, { ok: false, error: "Property is not a sales listing" }, rateLimitHeaders(rlIp));
    }
    if (String(tokenProperty.status || "") !== "available") {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "not_available", slot_id: slotId },
      });
      return json(409, { ok: false, error: "Property is not available" }, rateLimitHeaders(rlIp));
    }

    // 1) Get the slot (id, property)
    const { data: slotData, error: slotError } = await supabase
      .from("viewings")
      .select("id, slot_start, property_id")
      .eq("id", slotId)
      .single();

    if (slotError || !slotData) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "slot_not_found", slot_id: slotId },
      });
      return json(404, { ok: false, error: "Selected slot not found" }, rateLimitHeaders(rlIp));
    }

    const { property_id } = slotData;
    if (String(property_id) !== tokenPropertyId) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "slot_cross_property", slot_id: slotId },
      });
      return json(401, { ok: false, error: "Token does not match this slot/property" }, rateLimitHeaders(rlIp));
    }

    // 2) If the applicant already has a booking for this property, free it (same as Rentals: free one)
    const { data: existing } = await supabase
      .from("viewings")
      .select("id")
      .eq("applicant_id", applicantId)
      .eq("property_id", property_id)
      .eq("status", "booked")
      .maybeSingle();

    if (existing) {
      await supabase
        .from("viewings")
        .update({ status: "available", applicant_id: null })
        .eq("id", existing.id);
    }

    // 3) Book the new slot (target by id + only if still available)
    const { data: updatedSlots, error: updateError } = await supabase
      .from("viewings")
      .update({
        status: "booked",
        applicant_id: applicantId,
      })
      .eq("id", slotId)
      .eq("status", "available")
      .select("id, slot_start");

    if (updateError) {
      console.error("Supabase error:", updateError);
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "db_update_failed", slot_id: slotId },
      });
      return json(500, { ok: false, error: "Database update failed" }, rateLimitHeaders(rlIp));
    }

    if (!updatedSlots || updatedSlots.length === 0) {
      void writeAuditEvent(event, {
        event_type: "booking_slot_booked",
        token_to_hash: String(token).trim(),
        viewing_token_id: String(vt.id),
        applicant_id: applicantId,
        property_id: tokenPropertyId,
        meta: { ok: false, reason: "slot_not_available_anymore", slot_id: slotId },
      });
      return json(400, { ok: false, error: "Slot not available anymore" }, rateLimitHeaders(rlIp));
    }

    const newSlot = updatedSlots[0];

    void writeAuditEvent(event, {
      event_type: "booking_slot_booked",
      token_to_hash: String(token).trim(),
      viewing_token_id: String(vt.id),
      applicant_id: applicantId,
      property_id: tokenPropertyId,
      meta: { ok: true, slot_id: slotId, booked_slot_start: newSlot.slot_start },
    });

    // 4) Store the booked time on *sales_inquiries.viewing_time* (TEXT)
    {
      const { data: existingInquiry } = await supabase
        .from("sales_inquiries")
        .select("id")
        .eq("applicant_id", applicantId)
        .eq("property_id", property_id)
        .maybeSingle();

      if (existingInquiry?.id) {
        await supabase
          .from("sales_inquiries")
          .update({ viewing_time: newSlot.slot_start })
          .eq("id", existingInquiry.id);
      } else {
        // Fallback: ensure there's a row to attach the viewing time to
        await supabase.from("sales_inquiries").insert({
          applicant_id: applicantId,
          property_id,
          viewing_time: newSlot.slot_start,
          source: "booking_token",
        } as any);
      }
    }

    // 5) Fetch applicant & property for the confirmation email
    const { data: applicant } = await supabase
      .from("applicants")
      .select("full_name, email")
      .eq("id", applicantId)
      .single();

    const { data: property } = await supabase
      .from("properties")
      .select("property_configuration, address")
      .eq("id", property_id)
      .single();

    // 6) Send email (same style as Rentals: use newSlot.slot_start directly)
    if (applicant && property) {
      try {
        const transporter = nodemailer.createTransport({
          host: "mail.re-max.cz",
          port: 587,
          secure: false,
          auth: {
            user: process.env.REMAX_USER,
            pass: process.env.REMAX_PASSWORD,
          },
        });

        // Rentals formats directly from newSlot.slot_start
        const subject = `Potvrzení rezervace: ${property.property_configuration} ${property.address}`;
        const formattedTime = dayjs(newSlot.slot_start).format(
          "DD/MM/YYYY HH:mm"
        );

        const htmlBody = `
          <p>Dobrý den${
            applicant.full_name ? ` ${escapeHtml(applicant.full_name)}` : ""
          },</p>
          <p>Potvrzuji rezervaci Vaší prohlídky:</p>
          <ul>
            <li><strong>Nemovitost:</strong> ${escapeHtml(
              property.property_configuration
            )} ${escapeHtml(property.address)}</li>
            <li><strong>Datum a čas:</strong> ${formattedTime}</li>
          </ul>
          <p>Pokud by Vás do té doby napadly jakékoli otázky, neváhejte nás prosím kontaktovat.<br/>Těšíme se na Vás!</p>
          <p>S pozdravem,<br/>Jana Bodáková, RE/MAX Pro</p>
        `;

        await transporter.sendMail({
          from: `"Jana Bodakova" <jana.bodakova@re-max.cz>`,
          envelope: { from: process.env.REMAX_USER, to: applicant.email },
          to: applicant.email,
          subject,
          html: htmlBody,
        });
      } catch (mailErr) {
        console.error("Email sending failed:", mailErr);
      }
    }

    return json(200, { ok: true }, rateLimitHeaders(rlIp));
  } catch (err) {
    console.error("Booking error:", err);
    return json(500, { ok: false, error: "Internal server error" });
  }
};

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export { handler };

function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}
