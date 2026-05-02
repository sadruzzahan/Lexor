import { Link } from "wouter";
import { Command, Globe } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { useCmdK } from "@/lib/cmdk-store";

export function Header() {
  const { t, locale, toggleLocale } = useT();
  const openCmd = useCmdK((s) => s.setOpen);

  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-bg/70 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          <span>{BRAND.name}</span>
          <span className="text-fg-subtle text-xs uppercase tracking-widest hidden sm:inline">
            {t("header.parent")}
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/legal/disclaimer#find-attorney"
            className="hidden sm:inline-flex items-center text-sm text-fg-muted hover:text-fg transition-colors"
            data-testid="link-attorney"
          >
            {t("header.attorney")}
          </Link>

          <button
            type="button"
            onClick={toggleLocale}
            className="ghost-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-base text-xs font-mono"
            aria-label={t("header.lang")}
            data-testid="button-language"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{locale.toUpperCase()}</span>
          </button>

          <button
            type="button"
            onClick={() => openCmd(true)}
            className="ghost-btn hidden md:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-base"
            aria-label={t("header.cmdk.aria")}
            data-testid="button-cmdk"
          >
            <Command className="h-3.5 w-3.5" />
            <span className="kbd-chip border-0 bg-transparent p-0">⌘K</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
