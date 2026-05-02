import { Link, useLocation } from "wouter";
import { Home, Upload, MapPin, PhoneCall, User } from "lucide-react";
import { useT, type TKey } from "@/lib/i18n";

const tabs: ReadonlyArray<{
  href: string;
  label: TKey;
  icon: typeof Home;
  key: string;
}> = [
  { href: "/", label: "nav.home", icon: Home, key: "home" },
  { href: "/upload", label: "nav.upload", icon: Upload, key: "upload" },
  { href: "/map", label: "nav.map", icon: MapPin, key: "map" },
  { href: "/voice", label: "nav.voice", icon: PhoneCall, key: "voice" },
  { href: "/about", label: "nav.account", icon: User, key: "account" },
];

export function MobileTabBar() {
  const { t } = useT();
  const [location] = useLocation();
  return (
    <nav
      aria-label={t("nav.mobile.aria")}
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg/90 backdrop-blur"
    >
      <ul className="grid grid-cols-5">
        {tabs.map(({ href, label, icon: Icon, key }) => {
          const active = location === href;
          return (
            <li key={key}>
              <Link
                href={href}
                className="flex flex-col items-center justify-center gap-1 py-2.5 text-[11px]"
                data-testid={`tab-${key}`}
                style={{ color: active ? "var(--color-accent)" : "var(--color-fg-muted)" }}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span>{t(label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
