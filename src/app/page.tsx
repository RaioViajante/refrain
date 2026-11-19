import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

// Temporary: the home page's composition arrives in the next delivery.
export default function HomePage() {
  return (
    <>
      <SiteHeader home />
      <main
        id="conteudo"
        style={{ padding: "120px 20px 160px", textAlign: "center" }}
      >
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 58 }}>refrain</h1>
        <p style={{ fontStyle: "italic" }}>em construção.</p>
      </main>
      <SiteFooter />
    </>
  );
}
