// src/pages/SalesFinanceForm.tsx
// Purpose:
// - Render the Sales Finance form for a specific property, selected by :propertyCode in the URL.
// - Load property + applicant context via Netlify Function (no browser -> Supabase access).
// - Keep visual parity with the rental form (container, header, logo, App.css).
// - Submission wired to Netlify function captureSalesFinance (uses full_name).

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useLocation /*, useNavigate */ } from "react-router-dom";
import SalesFinanceSection from "../components/SalesFinanceSection";
import { type SalesFinanceFormData } from "../types/salesForm";
import "../App.css"; // reuse the exact styling as rental form

// Local initial form state (prefill later when we resolve applicant context)
const initialForm: SalesFinanceFormData = {
  jmeno: "",
  prijmeni: "", // kept in state for compatibility, but not required nor submitted
  telefon: "",
  email: "",
  financovani: "",
  vlastniProcent: "",
  hypotekyProcent: "",
  financniPoradce: "",
  stavHypoteky: "",
  vazanoNaProdej: "",
  poznamka: "",
};

export default function SalesFinanceForm() {
  const { propertyCode } = useParams();
  // const navigate = useNavigate();

  // Property state
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<SalesFinanceFormData>(initialForm);
  const [gdprConsent, setGdprConsent] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const location = useLocation();

  // Read a signed prefill token from the URL (?token=...)
  const token = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get("token");
  }, [location.search]);

  // Optional: allow finance submit using a booking token (if user arrived from booking flow)
  const bookingToken = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get("booking_token");
  }, [location.search]);

  // Friendly address label, falls back safely
  const addressLabel = useMemo(() => {
    if (!property) return "";
    const cfg = property.property_configuration?.trim();
    const addr = property.address?.trim();
    return cfg ? `${cfg} ${addr || ""}`.trim() : addr || "";
  }, [property]);

  // Load property + applicant context by :propertyCode (requires finance token OR booking token)
  useEffect(() => {
    let isActive = true;
    async function fetchContext() {
      setLoading(true);
      setLoadError(null);
      try {
        if (!propertyCode) {
          setLoadError("Chybí kód nemovitosti.");
          setProperty(null);
          return;
        }
        if (!token && !bookingToken) {
          setLoadError("Odkaz je neplatný (chybí bezpečný token).");
          setProperty(null);
          return;
        }

        const qs = new URLSearchParams();
        qs.set("property_code", propertyCode);
        if (token) qs.set("token", token);
        if (bookingToken) qs.set("booking_token", bookingToken);

        const res = await fetch(
          `/.netlify/functions/resolveSalesFinanceContext?${qs.toString()}`
        );
        const txt = await res.text();
        let data: any = null;
        try {
          data = txt ? JSON.parse(txt) : null;
        } catch {
          /* ignore */
        }

        if (!isActive) return;

        if (!res.ok || !data?.ok) {
          setLoadError(
            data?.error ||
              txt ||
              "Omlouváme se, nepodařilo se načíst údaje o nemovitosti."
          );
          setProperty(null);
          return;
        }

        setProperty(data.property);

        // Prefill applicant details
        setFormData((prev) => ({
          ...prev,
          jmeno: data.applicant?.full_name || prev.jmeno,
          email: data.applicant?.email || prev.email,
          telefon: data.applicant?.phone || prev.telefon,
        }));
        // Note: we intentionally do NOT auto-check GDPR
      } finally {
        if (isActive) setLoading(false);
      }
    }
    fetchContext();
    return () => {
      isActive = false;
    };
  }, [propertyCode, token, bookingToken]);

  // Basic form change handler (keeps parity with rentals)
  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  // Local validation (prijmeni no longer required)
  function validate(): string | null {
    const required = [
      ["jmeno", "Jméno a příjmení"],
      ["telefon", "Telefon"],
      ["email", "Email"],
      ["financovani", "Způsob financování"],
      ["financniPoradce", "Finanční poradce"],
      ["stavHypoteky", "Stav vyřizování hypotéky"],
      ["vazanoNaProdej", "Vázáno na prodej jiné nemovitosti"],
    ] as const;

    for (const [key, label] of required) {
      if (!String((formData as any)[key]).trim()) {
        return `Vyplňte prosím pole: ${label}.`;
      }
    }

    const usesMortgage =
      formData.financovani === "Hypotékou" ||
      formData.financovani === "Kombinací hypotéky a vlastních zdrojů";

    if (usesMortgage) {
      const own = formData.vlastniProcent
        ? Number(formData.vlastniProcent)
        : NaN;
      const mort = formData.hypotekyProcent
        ? Number(formData.hypotekyProcent)
        : NaN;

      if (Number.isNaN(own) && Number.isNaN(mort)) {
        return "Uveďte prosím alespoň přibližné procentuální rozdělení vlastních zdrojů a hypotéky.";
      }
      if (!Number.isNaN(own) && (own < 0 || own > 100)) {
        return "Hodnota „Vlastní zdroje (%)“ musí být mezi 0 a 100.";
      }
      if (!Number.isNaN(mort) && (mort < 0 || mort > 100)) {
        return "Hodnota „Hypotéka (%)“ musí být mezi 0 a 100.";
      }
      if (!Number.isNaN(own) && !Number.isNaN(mort) && own + mort > 100) {
        return "Součet procent nesmí přesáhnout 100.";
      }
    }

    if (!gdprConsent) {
      return "Musíte souhlasit se zpracováním osobních údajů (GDPR).";
    }

    return null;
  }

  // Submit handler wired to the Netlify function
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const err = validate();
    if (err) {
      setSubmitError(err);
      return;
    }
    if (!property) {
      setSubmitError("Nemovitost nenalezena.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        property_code: property.property_code as string,

        // ✅ Security: prove user came from a controlled link
        finance_token: token || undefined,
        booking_token: bookingToken || undefined,

        // ✅ single full name field (maps to applicants.full_name)
        full_name: formData.jmeno.trim(),

        email: formData.email.trim(),
        phone: formData.telefon.trim(),
        gdpr_consent: true, // required by backend

        financing_method: formData.financovani || null,
        own_funds_pct:
          formData.vlastniProcent !== ""
            ? Number(formData.vlastniProcent)
            : null,
        mortgage_pct:
          formData.hypotekyProcent !== ""
            ? Number(formData.hypotekyProcent)
            : null,
        has_advisor: formData.financniPoradce || null,
        mortgage_progress: formData.stavHypoteky || null,
        tied_to_sale: formData.vazanoNaProdej === "Ano",
        buyer_notes: formData.poznamka?.trim() || null,

        // Optional analytics, keep null for now
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
      };

      const res = await fetch("/.netlify/functions/captureSalesFinance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // More robust parsing in case of non-JSON errors
      const txt = await res.text();
      let data: any = null;
      try {
        data = txt ? JSON.parse(txt) : null;
      } catch {
        /* ignore */
      }

      if (!res.ok || !data?.ok) {
        const msg = data?.error || txt || "Submission failed";
        throw new Error(msg);
      }

      alert("Děkujeme! Vaše odpovědi jsme přijali.");
      // Optionally reset local state or navigate:
      // setFormData(initialForm);
      // setGdprConsent(false);
      // navigate("/thank-you");
    } catch (ex: any) {
      setSubmitError(
        ex?.message ||
          "Omlouvám se, nepodařilo se odeslat formulář. Zkuste to prosím znovu."
      );
    } finally {
      setSubmitting(false);
    }
  }

  // --- Render states to match rental UX ---
  if (loading) return <p>Načítám údaje o nemovitosti...</p>;
  if (loadError) {
    return (
      <div className="container">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div></div>
          <img
            src="/logo_pro.png"
            alt="Logo"
            style={{ height: "100px", objectFit: "contain" }}
          />
        </div>
        <h2 style={{ color: "#007BFF" }}>{loadError}</h2>
      </div>
    );
  }
  if (!property) return null;

  return (
    <div className="container">
      {/* Header/logo bar (identical to rentals) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div></div>
        <img
          src="/logo_pro.png"
          alt="Logo"
          style={{ height: "100px", objectFit: "contain" }}
        />
      </div>

      {/* Title + property context */}
      <h2>Prohlídka nemovitosti {property.property_code}</h2>
      <p>
        <b>Adresa:</b>{" "}
        {addressLabel ||
          (property.property_configuration
            ? `${property.property_configuration} ${property.address}`
            : property.address)}
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {/* Finance questionnaire fields, now with property address context */}
        <SalesFinanceSection
          formData={formData}
          handleChange={handleChange}
          propertyAddress={addressLabel}
          // viewingTimeText={formattedSlot} // optional: add once you resolve bookings
        />

        {/* GDPR line (same pattern as rental form) */}
        <div className="form-group gdpr-line">
          <input
            type="checkbox"
            id="gdprConsent"
            name="gdprConsent"
            checked={gdprConsent}
            onChange={(e) => setGdprConsent(e.target.checked)}
            required
          />
          <label htmlFor="gdprConsent">
            Souhlasím se zpracováním osobních údajů v souladu s GDPR.
            <span className="required-star">*</span>
          </label>
        </div>

        {/* Inline error display */}
        {submitError && (
          <div className="form-group" role="alert" aria-live="assertive">
            <div className="error-message">{submitError}</div>
          </div>
        )}

        <div className="form-group">
          <button type="submit" disabled={submitting}>
            {submitting ? "Odesílám…" : "Odeslat dotazník"}
          </button>
        </div>
      </form>
    </div>
  );
}
