import type { ComponentType } from "react";
import { useDocumentTitle } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";

interface SoonProps {
  titleKey: TKey;
  Icon: ComponentType<{ className?: string }>;
}

export function Soon({ titleKey, Icon }: SoonProps) {
  const { t } = useT();
  const title = t(titleKey);
  useDocumentTitle(`${title} · ${BRAND.name}`);

  return (
    <section className="relative mx-auto max-w-3xl px-4 sm:px-6 py-24 sm:py-32 text-center">
      <div
        aria-hidden
        className="mx-auto mb-8 inline-flex h-20 w-20 items-center justify-center rounded-xl2 border border-border-strong bg-bg-elevated"
      >
        <Icon className="h-9 w-9 text-accent" />
      </div>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 text-fg-muted">{t("soon")}</p>
      <p className="mt-3 text-sm text-fg-subtle max-w-md mx-auto leading-relaxed">
        {t("soon.note")}
      </p>
    </section>
  );
}
