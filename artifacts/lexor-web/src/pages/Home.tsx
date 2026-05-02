import { Hero } from "@/components/hero/Hero";
import { Bento } from "@/components/Bento";
import { useDocumentTitle } from "@/lib/hooks";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/i18n";

export default function Home() {
  const { t } = useT();
  useDocumentTitle(`${BRAND.name} — ${t("brand.tagline")}`);
  return (
    <>
      <Hero />
      <Bento />
    </>
  );
}
