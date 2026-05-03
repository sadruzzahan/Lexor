import { Link } from "wouter";
import { useT } from "@/lib/i18n";

export function Footer() {
  const { t } = useT();
  return (
    <footer className="border-t border-border bg-bg-elevated/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-fg-muted">
        <p className="leading-relaxed max-w-2xl" data-testid="text-footer-banner">
          {t("brand.footer")}
        </p>
        <nav className="flex items-center gap-4">
          <Link href="/legal/disclaimer" className="hover:text-fg transition-colors">
            {t("footer.disclaimer.link")}
          </Link>
          <Link href="/about" className="hover:text-fg transition-colors">
            {t("footer.about.link")}
          </Link>
          <Link href="/settings" className="hover:text-fg transition-colors">
            Inbox
          </Link>
          <a href="#privacy" className="hover:text-fg transition-colors">
            {t("footer.privacy.link")}
          </a>
        </nav>
      </div>
    </footer>
  );
}
