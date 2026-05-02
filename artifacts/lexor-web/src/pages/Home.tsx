import { Hero } from "@/components/hero/Hero";
import { Bento } from "@/components/Bento";
import { useDocumentTitle } from "@/lib/hooks";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/i18n";

export default function Home() {
  const { locale } = useT();
  useDocumentTitle(`${BRAND.name} — ${BRAND.tagline[locale]}`);
  return (
    <>
      <Hero />
      <Bento />
    </>
  );
}
