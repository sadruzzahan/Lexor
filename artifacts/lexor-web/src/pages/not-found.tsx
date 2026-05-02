import { Link } from "wouter";
import { Compass } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/hooks";
import { BRAND } from "@/lib/brand";

export default function NotFound() {
  const { t } = useT();
  useDocumentTitle(`${t("notfound.title")} · ${BRAND.name}`);
  return (
    <section className="mx-auto max-w-xl px-4 sm:px-6 py-24 sm:py-32 text-center">
      <div
        aria-hidden
        className="mx-auto mb-8 inline-flex h-20 w-20 items-center justify-center rounded-xl2 border border-border-strong bg-bg-elevated"
      >
        <Compass className="h-9 w-9 text-accent" />
      </div>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">
        {t("notfound.title")}
      </h1>
      <p className="mt-4 text-fg-muted">{t("notfound.body")}</p>
      <Link
        href="/"
        className="ghost-btn mt-8 inline-flex items-center rounded-base px-5 py-2.5 text-sm"
      >
        {t("notfound.cta")}
      </Link>
    </section>
  );
}
