// File: netlify/functions/bookSlot.ts  (SALES; same method as Rentals)
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import { rateLimit, rateLimitHeaders } from "./utils/rateLimit";
import { bodyTooLarge, getClientIp } from "./utils/request";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  REMAX_USER,
  REMAX_PASSWORD,
  FINANCE_LINK_SERVICE_URL,
  FINANCE_FORM_BASE_URL,
  IMG_BASE,
} = process.env;

const supabase = createClient(
  SUPABASE_URL as string,
  SUPABASE_SERVICE_ROLE_KEY as string
);

type PropertyEmailData = {
  address: string | null;
  property_configuration: string | null;
  docs_link: string | null;
  video_link: string | null;
  advert_link: string | null;
  map_link: string | null;
};

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Branded HTML email for fixed-time viewing confirmation + finance link.
 * Styling + footer follows sendViewingEmail.ts (composeHtmlViewingConfirmationEmail),
 * with an extra CTA button for the finance form.
 */
function composeHtmlViewingConfirmationWithFinanceEmail(
  p: PropertyEmailData,
  viewingTime: string,
  financeUrl: string | null
) {
  const address = escapeHtml(p.address || "");
  const configuration = escapeHtml(p.property_configuration || "");
  const map = p.map_link || "";

  const addressFragment = map
    ? `<a href="${map}" target="_blank" rel="noopener noreferrer" style="color:#1f497d;text-decoration:underline;font-weight:bold">${address}</a>`
    : address;

  // YOUR updated button style (inserted exactly as you want)
  const btnStyle = `
    display:inline-block;
    background-color:#e60000;
    color:#ffffff;
    text-decoration:none;
    font-weight:bold;
    padding:14px 22px;
    border-radius:8px;
    font-family:Arial,Helvetica,sans-serif;
    font-size:16px;
    box-shadow:0 2px 6px rgba(0,0,0,0.2);
  `;

  const base = IMG_BASE || "";
  const photoUrl = base ? `${base}/jana.jpg` : "";
  const brandUrl = base ? `${base}/BrandStrip-Small.jpeg` : "";

  const financeBlock = financeUrl
    ? `
      <p style="color:#2e4057">
        Vyplňte prosím krátký online dotazník, ve kterém mi můžete nezávazně sdělit, jaký způsob financování by pro Vás mohl být aktuální.
      </p>
      <div style="margin:12px 0">
        <a href="${financeUrl}" target="_blank" rel="noopener noreferrer" style="${btnStyle}">
          📝 Vyplnit online formulář
        </a>
      </div>
      <p style="color:#2e4057">
        Díky tomu Vám pak mohu:
      </p>
      <ul style="color:#2e4057;padding-left:20px;margin-top:4px;margin-bottom:12px">
        <li>lépe přizpůsobit průběh celé transakce,</li>
        <li>v případě potřeby nabídnout propojení na ověřeného finančního poradce,</li>
        <li>nebo např. doladit termíny a další kroky přesně podle Vašich možností.</li>
      </ul>
      <p style="color:#2e4057">
        Pokud už máte financování zajištěné nebo rozjednané, je to skvělé – i to mi v rámci koordinace celého procesu hodně pomůže.
      </p>
    `
    : "";

  const innerHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#2e4057">

      <p style="color:#2e4057">Dobrý den,</p>

      <p style="color:#2e4057">
        děkuji za Váš zájem o prohlídku nemovitosti. Těším se na setkání s Vámi dne
        <strong>${escapeHtml(
          viewingTime
        )}</strong>, na adrese ${addressFragment},
        kdy si společně projdeme bydlení, které Vás zaujalo.
      </p>

      <p style="color:#2e4057">
        Abych Vám mohla v případě zájmu poskytnout co nejefektivnější podporu a celý proces koupě probíhal co nejhladčeji,
        dovolím si ještě malou prosbu.
      </p>

      ${financeBlock}

      <p style="color:#2e4057">
        Děkuji za spolupráci a kdyby cokoli, jsem Vám k dispozici.
      </p>

      <p style="color:#2e4057">Těším se na viděnou!</p>

      <!-- SIGNATURE (unchanged) -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
            style="width:100%;max-width:640px;margin-top:12px;font-size:0;line-height:0">
        <tr>
          <td style="width:96px;vertical-align:top;padding:6px 8px 6px 0">
            ${
              photoUrl
                ? `<img src="${photoUrl}" alt="Jana Bodáková" width="96"
                  style="display:block;border:0;outline:none;border-radius:6px;max-width:100%;height:auto" />`
                : ""
            }
          </td>
          <td style="vertical-align:top;padding:6px 0;font-size:15px;line-height:1.6;color:#2e4057">
            <div>
              <strong style="color:#1f497d">Jana Bodáková</strong><br/>
              Vaše realitní makléřka<br/>
              M: +420&nbsp;736&nbsp;780&nbsp;983<br/>
              E: <a href="mailto:jana.bodakova@re-max.cz" style="color:#1f497d;text-decoration:none">jana.bodakova@re-max.cz</a>
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:8px 0 0 0;text-align:left">
            ${
              brandUrl
                ? `<img src="${brandUrl}" alt="RE/MAX Brand" width="300"
                  style="display:inline-block;border:0;outline:none;max-width:100%;height:auto"/>`
                : ""
            }
          </td>
        </tr>
      </table>

    </div>
  `.trim();

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        bgcolor="#1f497d" style="background-color:#1f497d;width:100%">
    <tr>
      <td align="center" valign="top" style="padding:6px;font-size:0;line-height:0">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
              bgcolor="#ffffff"
              style="border-collapse:separate;width:100%;max-width:600px;background-color:#ffffff;border-spacing:0">
          <tr>
            <td style="padding:20px">
              ${innerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  `.trim();
}

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
      return json(401, { ok: false, error: "Invalid token (property missing)" }, rateLimitHeaders(rlIp));
    }

    const bt = String(tokenProperty.business_type || "").toLowerCase();
    if (!(bt === "sell" || bt === "prodej" || bt === "sale")) {
      return json(409, { ok: false, error: "Property is not a sales listing" }, rateLimitHeaders(rlIp));
    }
    if (String(tokenProperty.status || "") !== "available") {
      return json(409, { ok: false, error: "Property is not available" }, rateLimitHeaders(rlIp));
    }

    // 1) Get the slot (id, property)
    const { data: slotData, error: slotError } = await supabase
      .from("viewings")
      .select("id, slot_start, property_id")
      .eq("id", slotId)
      .single();

    if (slotError || !slotData) {
      return json(404, { ok: false, error: "Selected slot not found" }, rateLimitHeaders(rlIp));
    }

    const { property_id } = slotData;
    if (String(property_id) !== tokenPropertyId) {
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
      return json(500, { ok: false, error: "Database update failed" }, rateLimitHeaders(rlIp));
    }

    if (!updatedSlots || updatedSlots.length === 0) {
      return json(400, { ok: false, error: "Slot not available anymore" }, rateLimitHeaders(rlIp));
    }

    const newSlot = updatedSlots[0];

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
      .select(
        "property_configuration, address, property_code, docs_link, video_link, advert_link, map_link"
      )
      .eq("id", property_id)
      .single();

    // 6) Generate finance-form link via existing admin function (if configured)
    let financeUrl: string | null = null;

    if (
      FINANCE_LINK_SERVICE_URL &&
      FINANCE_FORM_BASE_URL &&
      property?.property_code
    ) {
      try {
        const res = await fetch(FINANCE_LINK_SERVICE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicant_id: applicantId,
            property_code: property.property_code,
            base_url: FINANCE_FORM_BASE_URL,
            // optional: expires_in_days: 7,
          }),
        });

        const txt = await res.text();
        let data: any = null;
        try {
          data = txt ? JSON.parse(txt) : null;
        } catch (e) {
          console.error("bookSlot:createFinanceFormLink JSON parse error:", e);
        }

        if (!res.ok || !data?.ok || !data?.url) {
          console.error(
            "bookSlot:createFinanceFormLink failed:",
            res.status,
            txt
          );
        } else {
          financeUrl = data.url as string;
        }
      } catch (e) {
        console.error("bookSlot:createFinanceFormLink error:", e);
      }
    } else {
      if (!FINANCE_LINK_SERVICE_URL || !FINANCE_FORM_BASE_URL) {
        console.warn(
          "Finance link envs missing – FINANCE_LINK_SERVICE_URL and/or FINANCE_FORM_BASE_URL are not set. Email will be sent without finance link."
        );
      }
    }

    // 7) Send email (branded, with optional finance CTA)
    if (applicant && property) {
      try {
        const smtpUser = (REMAX_USER || "").trim();
        const smtpPass = (REMAX_PASSWORD || "").trim();

        if (!smtpUser || !smtpPass) {
          console.error(
            "BOOK SLOT EMAIL ERROR: Missing SMTP credentials (REMAX_USER/REMAX_PASSWORD)."
          );
        } else {
          const transporter = nodemailer.createTransport({
            host: "mail.re-max.cz",
            port: 587,
            secure: false,
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

          const formattedTime = dayjs(newSlot.slot_start).format(
            "DD/MM/YYYY HH:mm"
          );

          const propertyData: PropertyEmailData = {
            address: property.address ?? null,
            property_configuration: property.property_configuration ?? null,
            docs_link: property.docs_link ?? null,
            video_link: property.video_link ?? null,
            advert_link: property.advert_link ?? null,
            map_link: property.map_link ?? null,
          };

          const htmlBody = composeHtmlViewingConfirmationWithFinanceEmail(
            propertyData,
            formattedTime,
            financeUrl
          );

          // Subject explicitly mentions finance form to distinguish from other auto-responses
          const subject = "Potvrzení termínu prohlídky + malá prosba";

          await transporter.sendMail({
            from: `"Jana Bodáková" <${smtpUser}>`,
            envelope: { from: smtpUser, to: applicant.email },
            to: applicant.email,
            subject,
            html: htmlBody,
          });
        }
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

export { handler };

function json(status: number, body: any, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}
