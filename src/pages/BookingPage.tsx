// File: src/pages/BookingPage.tsx  (SALES booking using ?token=<TOKEN>)
import "../App.css";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import KulkarniConsultingNote from "../components/KulkarniConsultingNote";
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Europe/Prague");

type UUID = string;

interface Slot {
  id: UUID;
  slot_start: string; // DB timestamptz as string
  slot_end: string;
  status: "available" | "booked" | "cancelled";
}

export default function BookingPage() {
  const { propertyCode } = useParams<{ propertyCode: string }>();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [existingBooking, setExistingBooking] = useState<string | null>(null);
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSlots() {
      if (!propertyCode || !token) {
        setMessage("❌ Chybí identifikace nemovitosti nebo bezpečný token.");
        setLoading(false);
        return;
      }

      // Load booking context via Netlify function (no browser -> Supabase access)
      const res = await fetch(
        `/.netlify/functions/getBookingPageData?token=${encodeURIComponent(
          token
        )}&property_code=${encodeURIComponent(propertyCode)}`
      );
      const txt = await res.text();
      let data: any = null;
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch {
        /* ignore */
      }
      if (!res.ok || !data?.ok) {
        setMessage("❌ Neplatný nebo expirovaný odkaz k rezervaci.");
        setLoading(false);
        return;
      }

      if (data?.existing_viewing_time) {
        const dt = dayjs(String(data.existing_viewing_time)).tz("Europe/Prague");
        setExistingBooking(
          `Máte rezervovaný termín prohlídky: ${dt.format(
            "DD/MM/YYYY"
          )} v ${dt.format(
            "HH:mm"
          )}. Pokud chcete změnit čas, vyberte prosím jiný z dostupných termínů níže.`
        );
      }

      setSlots((data.slots || []) as Slot[]);
      setLoading(false);
    }

    fetchSlots();
  }, [propertyCode, token]);

  const handleBooking = async (slotId: string) => {
    if (!token) {
      setMessage("❌ Chybí bezpečný token.");
      return;
    }
    if (bookingSlotId) return; // prevent double-clicks / parallel requests

    setBookingSlotId(slotId);
    setMessage("⏳ Rezervuji termín, prosím vyčkejte…");
    try {
      const res = await fetch("/.netlify/functions/bookSlot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, token }),
      });

      const txt = await res.text();
      let data: any = null;
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch {}

      if (res.ok && data?.ok) {
        setMessage(
          "✅ Váš čas byl úspěšně rezervován! Brzy obdržíte potvrzovací e-mail."
        );
        setSlots((prev) => prev.filter((s) => s.id !== slotId));
      } else {
        setMessage("❌ Rezervace se nezdařila: " + (data?.error || txt));
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Rezervační požadavek selhal.");
    } finally {
      setBookingSlotId(null);
    }
  };

  if (loading) return <div>Načítám dostupné sloty…</div>;

  // Group by date (Prague)
  const groupedSlots = slots.reduce<Record<string, Slot[]>>((acc, slot) => {
    const dateKey = dayjs
      .tz(slot.slot_start, "Europe/Prague")
      .format("DD/MM/YYYY");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(slot);
    return acc;
  }, {});

  return (
    <div style={{ padding: "20px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>Rezervace prohlídky</h1>
        <img
          src="/logo_pro.png"
          alt="Logo"
          style={{ height: "100px", objectFit: "contain" }}
        />
      </div>

      {message && (
        <div style={{ marginBottom: "15px", color: "blue" }}>{message}</div>
      )}

      {existingBooking && (
        <div style={{ marginBottom: "20px", fontWeight: "bold" }}>
          {existingBooking}
        </div>
      )}

      {slots.length === 0 ? (
        <p>Žádné dostupné sloty.</p>
      ) : (
        Object.entries(groupedSlots).map(([date, daySlots]) => (
          <div
            key={date}
            style={{
              border: "2px solid #0054a4",
              borderRadius: "8px",
              padding: "10px",
              marginBottom: "20px",
              backgroundColor: "#f9f9f9",
            }}
          >
            <h3 style={{ marginTop: 0, color: "#0054a4" }}>{date}</h3>
            <ul style={{ listStyle: "none", paddingLeft: 0 }}>
              {daySlots.map((slot) => (
                <li key={slot.id} style={{ marginBottom: "10px" }}>
                  {dayjs.tz(slot.slot_start, "Europe/Prague").format("HH:mm")} –{" "}
                  {dayjs.tz(slot.slot_end, "Europe/Prague").format("HH:mm")}
                  <button
                    disabled={!!bookingSlotId}
                    style={{
                      backgroundColor: "#0054a4",
                      marginLeft: "10px",
                      padding: "4px 8px",
                      cursor: bookingSlotId ? "not-allowed" : "pointer",
                      opacity: bookingSlotId ? 0.7 : 1,
                    }}
                    onClick={() => handleBooking(slot.id)}
                  >
                    {bookingSlotId === slot.id ? "Rezervuji…" : "Rezervovat"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <KulkarniConsultingNote />
    </div>
  );
}
