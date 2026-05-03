import { useDocumentTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";
import { RevealText } from "@/components/RevealText";

export default function About() {
  const { t } = useT();
  useDocumentTitle(`${t("page.about.title")} · ${BRAND.name}`);
  return (
    <article className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24">
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">
        {t("page.about.title")}
      </h1>
      <RevealText as="p" className="mt-6 text-lg text-fg-muted leading-relaxed">
        {t("about.lead")}
      </RevealText>
      <RevealText as="p" className="mt-4 text-fg-muted leading-relaxed" delay={0.1}>
        {t("about.body")}
      </RevealText>
      <p className="mt-10 text-xs text-fg-subtle font-mono">
        {BRAND.name.toLowerCase()} · {BRAND.parent}
      </p>
    </article>
  );
}
