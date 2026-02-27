// File: src/pages/ThankYouPage.tsx
import "../App.css";

export default function ThankYouPage() {
  return (
    <div className="container" style={{ padding: "2rem" }}>
      <div className="page-header">
        <img
          src="/images/remax_logo_NEW.png"
          alt="REMAX"
          className="remax-logo"
        />
      </div>
      <h2 style={{ color: "#0043ff" }}>
        Děkujeme, že jste si našli čas na vyplnění formuláře.
      </h2>
      <p>Formulář byl úspěšně odeslán makléřce.</p>
    </div>
  );
}
