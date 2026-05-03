import { useEffect } from "react";
import { Command } from "cmdk";
import { useLocation } from "wouter";
import { useCmdK } from "@/lib/cmdk-store";
import { useT } from "@/lib/i18n";
import { useDisclaimer } from "@/lib/disclaimer";
import { BRAND } from "@/lib/brand";
import {
  FilePlus2,
  Search,
  MapPin,
  Globe,
  PhoneCall,
  Users,
  ShieldAlert,
  Home,
  Upload,
  Inbox,
} from "lucide-react";

export function CommandPalette() {
  const open = useCmdK((s) => s.open);
  const setOpen = useCmdK((s) => s.setOpen);
  const toggle = useCmdK((s) => s.toggle);
  const { t, toggleLocale } = useT();
  const reopenDisc = useDisclaimer((s) => s.reopen);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmdk.aria")}
    >
      <button
        type="button"
        aria-label={t("cmdk.close")}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <Command
        label={t("cmdk.label")}
        className="relative w-full max-w-lg rounded-lg2 border border-border-strong bg-bg-elevated shadow-2xl overflow-hidden"
        data-testid="cmdk-root"
      >
        <Command.Input
          placeholder={t("cmdk.placeholder")}
          className="w-full bg-transparent px-4 py-3.5 text-sm outline-none border-b border-border placeholder:text-fg-subtle"
          autoFocus
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-sm text-fg-muted text-center">
            {t("cmdk.empty")}
          </Command.Empty>

          <Command.Group heading={t("cmdk.group.go")} className="px-1 py-1 text-[11px] uppercase tracking-wider text-fg-subtle">
            <Item icon={<Home className="h-4 w-4" />} onSelect={() => go("/")}>{t("nav.home")}</Item>
            <Item icon={<Upload className="h-4 w-4" />} onSelect={() => go("/upload")}>{t("nav.upload")}</Item>
            <Item icon={<MapPin className="h-4 w-4" />} onSelect={() => go("/map")}>{t("nav.map")}</Item>
            <Item icon={<Users className="h-4 w-4" />} onSelect={() => go("/coalition/all")}>{t("nav.coalitions")}</Item>
            <Item icon={<PhoneCall className="h-4 w-4" />} onSelect={() => go("/voice")}>{t("nav.voice")}</Item>
            <Item icon={<Inbox className="h-4 w-4" />} onSelect={() => go("/settings")}>Inbox Sentinel</Item>
          </Command.Group>

          <Command.Group heading={t("cmdk.group.actions")} className="px-1 py-1 text-[11px] uppercase tracking-wider text-fg-subtle">
            <Item icon={<FilePlus2 className="h-4 w-4" />} onSelect={() => go("/upload")}>
              {t("cmdk.new")}
            </Item>
            <Item icon={<Search className="h-4 w-4" />} onSelect={() => go("/entity/search")}>
              {t("cmdk.entity")}
            </Item>
            <Item icon={<Globe className="h-4 w-4" />} onSelect={() => { toggleLocale(); setOpen(false); }}>
              {t("cmdk.lang")}
            </Item>
            <Item icon={<PhoneCall className="h-4 w-4" />} onSelect={() => { window.location.href = `tel:${BRAND.phone.replace(/[^+\d]/g, "")}`; setOpen(false); }}>
              {t("cmdk.call")}
            </Item>
            <Item icon={<ShieldAlert className="h-4 w-4" />} onSelect={() => { reopenDisc(); setOpen(false); }}>
              {t("cmdk.disclaimers")}
            </Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function Item({
  icon,
  children,
  onSelect,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-base text-sm text-fg cursor-pointer aria-selected:bg-bg-raised aria-selected:text-fg"
    >
      <span className="text-fg-muted">{icon}</span>
      <span>{children}</span>
    </Command.Item>
  );
}
