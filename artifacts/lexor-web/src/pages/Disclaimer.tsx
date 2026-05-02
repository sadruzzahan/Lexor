import { useDocumentTitle } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";

export default function DisclaimerPage() {
  const { t } = useT();
  useDocumentTitle(`${t("page.disclaimer.title")} · ${BRAND.name}`);

  return (
    <article className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24">
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">
        {t("page.disclaimer.title")}
      </h1>

      <div className="mt-8 space-y-4 text-base leading-relaxed text-fg-muted">
        <p className="text-fg">{t("modal.body.lead")}</p>
        <ol className="space-y-3 list-decimal list-inside">
          <li>
            <span className="font-semibold text-fg">{t("modal.body.p1.head")}</span>{" "}
            {t("modal.body.p1.text")}
          </li>
          <li>
            <span className="font-semibold text-fg">{t("modal.body.p2.head")}</span>{" "}
            {t("modal.body.p2.text")}
          </li>
          <li>
            <span className="font-semibold text-fg">{t("modal.body.p3.head")}</span>{" "}
            {t("modal.body.p3.text")}
          </li>
        </ol>
        <p>{t("modal.body.tail")}</p>
      </div>

      <section
        id="find-attorney"
        className="mt-16 scroll-mt-24 rounded-lg2 border border-border bg-bg-elevated/60 p-6 sm:p-8"
      >
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {t("attorney.section.title")}
        </h2>
        <p className="mt-3 text-fg-muted leading-relaxed">{t("attorney.section.body")}</p>
      </section>
    </article>
  );
}
