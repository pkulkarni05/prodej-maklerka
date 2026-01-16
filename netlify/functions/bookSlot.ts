// File: netlify/functions/bookSlot.ts  (SALES; same method as Rentals)
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import dayjs from "dayjs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { slotId, token } = JSON.parse(event.body || "{}") as {
      slotId?: string;
      token?: string;
    };

    if (!slotId || !token) {
      return { statusCode: 400, body: "Missing slotId or token" };
    }

    // 0) Resolve booking token -> applicant_id + property_id (and validate sales+available)
    const { data: vt, error: vtErr } = await supabase
      .from("viewing_tokens")
      .select("id, applicant_id, property_id, token, used")
      .eq("token", String(token).trim())
      .maybeSingle();

    if (vtErr || !vt?.applicant_id || !vt?.property_id) {
      return { statusCode: 401, body: "Invalid token" };
    }

    const applicantId = String(vt.applicant_id);
    const tokenPropertyId = String(vt.property_id);

    const { data: tokenProperty, error: tokenPropErr } = await supabase
      .from("properties")
      .select("id, business_type, status")
      .eq("id", tokenPropertyId)
      .single();

    if (tokenPropErr || !tokenProperty) {
      return { statusCode: 401, body: "Invalid token (property missing)" };
    }

    const bt = String(tokenProperty.business_type || "").toLowerCase();
    if (!(bt === "sell" || bt === "prodej" || bt === "sale")) {
      return { statusCode: 409, body: "Property is not a sales listing" };
    }
    if (String(tokenProperty.status || "") !== "available") {
      return { statusCode: 409, body: "Property is not available" };
    }

    // 1) Get the slot (id, property)
    const { data: slotData, error: slotError } = await supabase
      .from("viewings")
      .select("id, slot_start, property_id")
      .eq("id", slotId)
      .single();

    if (slotError || !slotData) {
      return { statusCode: 404, body: "Selected slot not found" };
    }

    const { property_id } = slotData;
    if (String(property_id) !== tokenPropertyId) {
      return { statusCode: 401, body: "Token does not match this slot/property" };
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
      return { statusCode: 500, body: "Database update failed" };
    }

    if (!updatedSlots || updatedSlots.length === 0) {
      return { statusCode: 400, body: "Slot not available anymore" };
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

    return { statusCode: 200, body: "Slot booked successfully" };
  } catch (err) {
    console.error("Booking error:", err);
    return { statusCode: 500, body: "Internal server error" };
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
