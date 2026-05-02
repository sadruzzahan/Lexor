import { useDocumentTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";

export default function About() {
  const { t } = useT();
  useDocumentTitle(`${t("page.about.title")} · ${BRAND.name}`);
  return (
    <article className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24">
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">
        {t("page.about.title")}
      </h1>
      <p className="mt-6 text-lg text-fg-muted leading-relaxed">{t("about.lead")}</p>
      <p className="mt-4 text-fg-muted leading-relaxed">{t("about.body")}</p>
      <p className="mt-10 text-xs text-fg-subtle font-mono">
        {BRAND.name.toLowerCase()} · {BRAND.parent}
      </p>
    </article>
  );
}
