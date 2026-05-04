import { Languages } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { usePlainEnglish } from "./PlainEnglishProvider";
import { selection } from "@/lib/haptics";

/**
 * G19 / B4 — Header toggle. ON renders legal terms with plain-language
 * glosses + tooltips. Persistent preference (localStorage).
 */
export function PlainEnglishToggle() {
  const { enabled, setEnabled } = usePlainEnglish();
  return (
    <label
      className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-2.5 py-1 text-[11px]"
      data-testid="plain-english-toggle"
    >
      <Languages className="size-3.5 text-muted-foreground" />
      <span className="text-foreground/90">Plain English</span>
      <Switch
        checked={enabled}
        onCheckedChange={(v) => {
          selection();
          setEnabled(v);
        }}
        data-testid="plain-english-switch"
        aria-label="Plain English toggle"
      />
    </label>
  );
}
