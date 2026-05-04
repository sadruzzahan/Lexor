import { Plus } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { selection } from "@/lib/haptics";
import { HapticSystem } from "@/theme/haptics";
import { SoundSystem } from "@/theme/sounds";

interface FabProps {
  onClick?: () => void;
  className?: string;
  label?: string;
}

export default function Fab({ onClick, className, label = "New case" }: FabProps) {
  const reduce = useReducedMotion();
  return (
    // G17 / M1 — FAB tray sits in a Liquid Glass shell with the Linear-violet
    // accent ring on top, anchored on the foreground depth layer.
    <div
      className={cn(
        "fixed bottom-6 right-6 z-30 rounded-full p-1 shadow-lg glass glass-md",
        className,
      )}
    >
      <motion.button
        type="button"
        onClick={() => {
          // Keep the legacy lib/haptics shim alongside the G17 design-system
          // helpers so existing call sites and tests stay wired.
          selection();
          HapticSystem.selection();
          SoundSystem.play("tap");
          onClick?.();
        }}
        aria-label={label}
        data-testid="fab-new-case"
        whileHover={reduce ? undefined : { scale: 1.06 }}
        whileTap={reduce ? undefined : { scale: 0.94 }}
        transition={{ type: "spring", stiffness: 400, damping: 22 }}
        className={cn(
          "grid h-14 w-14 place-items-center rounded-full text-white",
          "shadow-[0_10px_30px_-8px_hsl(var(--violet)/0.7)]",
          "ring-1 ring-[color:var(--color-accent-violet)]/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--violet)) 0%, hsl(265 85% 65%) 100%)",
        }}
      >
        <Plus className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
