// File: src/pages/Home.tsx
import KulkarniConsultingNote from "../components/KulkarniConsultingNote";
export default function Home() {
  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "auto" }}>
      <h2>
        Vítejte na stránce k prodeji nemovitostí <br></br>z portfolia Jany
        Bodákové
      </h2>
      <p>
        Děkujeme, že jste navštívili naši stránku s dokumenty pro prodej
        nemovitostí v Brně a okolí. Pro přístup k formulářům prosím použijte
        konkrétní odkaz, který jste obdrželi.
      </p>
      <p>
        Pokud odkaz nemáte, obraťte se na realitní makléřku, která vám ho ráda
        poskytne.
      </p>
      <KulkarniConsultingNote />
    </div>
  );
}
