// src/components/SalesFinanceSection.tsx
// Purpose: Presentational component. Receives property/applicant context as props.

import React from "react";
import JanaPic from "../assets/jana.jpg";
import BrandStrip from "../assets/BrandStrip-Small.jpeg";
import FormInput from "./FormInput";
import {
  type SalesFinanceFormData,
  type FinancingMethod,
  type MortgageAdvisorChoice,
  type MortgageProgress,
  type TiedToSale,
} from "../types/salesForm";

interface Props {
  formData: SalesFinanceFormData;
  handleChange: (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => void;
  /** Human-readable address, e.g., "3+1 Klíny 12, Brno" or "Klíny 12, Brno" */
  propertyAddress?: string;
  /** Optional preformatted viewing time text, e.g., "úterý 21. 10. 2025 v 17:30" */
  viewingTimeText?: string;
}

export default function SalesFinanceSection({
  formData,
  handleChange,
  propertyAddress,
  viewingTimeText,
}: Props) {
  const fm = formData.financovani;
  const ownOnly = fm === "Vlastními zdroji";
  const mortgageOnly = fm === "Hypotékou";
  const combo = fm === "Kombinací hypotéky a vlastních zdrojů";

  // Visibility matrix for questions 2–6
  const showQ2 = combo;
  const showQ3 = mortgageOnly || combo;
  const showQ4 = mortgageOnly || combo;
  const showQ5 = ownOnly || mortgageOnly || combo;
  const showQ6 = ownOnly || mortgageOnly || combo;

  return (
    <fieldset>
      <legend>KRÁTKÝ DOTAZNÍK K FINANCOVÁNÍ</legend>

      {/* Intro paragraph uses dynamic address and (optionally) booked viewing time */}
      <div className="form-group">
        <p style={{ marginTop: 0 }}>
          <br />
          Dobrý den,
          <br />
          <br />
          {/* If we know the slot, mention it; otherwise keep the generic thank-you */}
          {viewingTimeText ? (
            <>
              děkuji Vám za rezervaci termínu prohlídky{" "}
              {propertyAddress ? (
                <>bytu na adrese {propertyAddress}</>
              ) : (
                <>tohoto bytu</>
              )}{" "}
              na {viewingTimeText}.{" "}
            </>
          ) : (
            <>
              děkuji Vám za Váš zájem o prodávanou nemovitost na adrese{" "}
              {propertyAddress ? <>{propertyAddress}</> : <>tohoto bytu</>}.{" "}
            </>
          )}
          Abych mohla celý proces přizpůsobit Vaší situaci a zajistit plynulý
          průběh, dovolím si Vás požádat o vyplnění krátkého dotazníku. Nezabere
          Vám více než 1–2 minuty.
          <br />
          Děkuji předem za spolupráci!
        </p>
      </div>

      {/* Identification */}
      <div className="form-group">
        <FormInput
          label="Jméno a příjmení"
          name="jmeno"
          value={formData.jmeno}
          onChange={handleChange}
          required
        />
      </div>
      <div className="form-group">
        <FormInput
          label="Telefon"
          name="telefon"
          value={formData.telefon}
          onChange={handleChange}
          required
        />
      </div>
      <div className="form-group">
        <FormInput
          label="Email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          required
        />
      </div>

      {/* Q1 */}
      <div className="form-group">
        <label>
          1. Jak plánujete financovat koupi nemovitosti?
          <span className="required-star">*</span>
        </label>
        <select
          name="financovani"
          value={formData.financovani}
          onChange={handleChange}
          required
        >
          <option value="">-- Vyberte --</option>
          {[
            "Vlastními zdroji",
            "Hypotékou",
            "Kombinací hypotéky a vlastních zdrojů",
          ].map((opt) => (
            <option key={opt} value={opt as FinancingMethod}>
              {opt}
            </option>
          ))}
        </select>
        <br></br>{" "}
        <small>
          <em>
            Po výběru možnosti se Vám zobrazí jen otázky, které se Vaší situace
            týkají.
          </em>
        </small>
      </div>

      {/* Q2 – only for "kombinace" */}
      {showQ2 && (
        <div className="form-group">
          <label>
            2. Pokud plánujete kombinovat vlastní zdroje a hypotéku, jaký je
            přibližný poměr financování?
          </label>
          <div
            style={{
              display: "grid",
              gap: "8px",
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <div>
              <label htmlFor="vlastniProcent">💰 Vlastní zdroje (%)</label>
              <input
                id="vlastniProcent"
                type="number"
                min={0}
                max={100}
                step={1}
                name="vlastniProcent"
                value={formData.vlastniProcent}
                onChange={handleChange}
                placeholder="např. 20"
              />
            </div>
            <div>
              <label htmlFor="hypotekyProcent">🏦 Hypotéka (%)</label>
              <input
                id="hypotekyProcent"
                type="number"
                min={0}
                max={100}
                step={1}
                name="hypotekyProcent"
                value={formData.hypotekyProcent}
                onChange={handleChange}
                placeholder="např. 80"
              />
            </div>
          </div>
        </div>
      )}

      {/* Q3 – only for "Hypotékou" or "Kombinací..." */}
      {showQ3 && (
        <div className="form-group">
          <label>
            3. Máte už k hypotéce svého finančního poradce?
            <span className="required-star">*</span>
          </label>
          <select
            name="financniPoradce"
            value={formData.financniPoradce}
            onChange={handleChange}
            required
          >
            <option value="">-- Vyberte --</option>
            {[
              "Ano",
              "Ne",
              "Ne, uvítal/a bych doporučení na spolehlivého specialistu",
            ].map((opt) => (
              <option key={opt} value={opt as MortgageAdvisorChoice}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Q4 – only for "Hypotékou" or "Kombinací..." */}
      {showQ4 && (
        <div className="form-group">
          <label>
            4. Jak daleko jste s vyřizováním hypotéky?
            <span className="required-star">*</span>
          </label>
          <select
            name="stavHypoteky"
            value={formData.stavHypoteky}
            onChange={handleChange}
            required
          >
            <option value="">-- Vyberte --</option>
            {[
              "Teprve budu začínat",
              "Zatím zjišťuji možnosti a podmínky",
              "Mám již rozjednanou hypotéku / konzultaci v bance",
              "Hypotéku mám již schválenou",
            ].map((opt) => (
              <option key={opt} value={opt as MortgageProgress}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Q5 – shown for all three financing options (except when none selected yet) */}
      {showQ5 && (
        <div className="form-group">
          <label>
            5. Je Vaše koupě vázaná na prodej jiné nemovitosti?
            <span className="required-star">*</span>
          </label>
          <select
            name="vazanoNaProdej"
            value={formData.vazanoNaProdej}
            onChange={handleChange}
            required
          >
            <option value="">-- Vyberte --</option>
            {["Ano", "Ne"].map((opt) => (
              <option key={opt} value={opt as TiedToSale}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Q6 – shown for all three financing options (except when none selected yet) */}
      {showQ6 && (
        <div className="form-group">
          <label htmlFor="poznamka">
            6. Máte k financování nebo nemovitosti nějakou otázku či poznámku, o
            které bych měla vědět před prohlídkou?{" "}
            <small>
              <em>(Volitelné)</em>
            </small>
          </label>
          <textarea
            id="poznamka"
            name="poznamka"
            value={formData.poznamka}
            onChange={handleChange}
            rows={4}
            placeholder="Vaše poznámka…"
          />
        </div>
      )}

      {/* Outro */}
      <div className="form-group">
        <p className="text-center mb-4">
          🔒 Vaše odpovědi jsou důvěrné a pomohou mi přizpůsobit celý proces
          tak, aby pro Vás byl co nejpříjemnější a nejefektivnější.
          <br />
          <br />
          Děkuji Vám za spolupráci a těším se na osobní setkání!
        </p>
        <br />
        {/* 3-column outro layout */}
        <div className="outro-3col">
          {/* Column 1: Photo */}
          <div className="outro-photo">
            <img src={JanaPic} alt="Jana Bodáková" className="agent-photo" />
          </div>

          {/* Column 2: Signature text */}
          <div className="outro-signature">
            <strong>Jana Bodáková</strong>
            <br />
            Vaše realitní makléřka
            <br />
            M: +420 736 780 983
            <br />
            E:{" "}
            <a href="mailto:jana.bodakova@re-max.cz">jana.bodakova@re-max.cz</a>
          </div>

          {/* Column 3: Brand strip */}
          <div className="outro-brand">
            <img
              src={BrandStrip}
              alt="Branding strip"
              className="brand-strip"
            />
          </div>
        </div>
      </div>
    </fieldset>
  );
}
