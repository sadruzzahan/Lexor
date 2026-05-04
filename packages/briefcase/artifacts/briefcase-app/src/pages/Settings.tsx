import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassAppBar } from "@/components/GlassAppBar";
import { AuroraBackground } from "@/components/AuroraBackground";
import EmptyState from "@/components/EmptyState";
import { PlainEnglishToggle } from "@/components/plain-english/PlainEnglishToggle";
import { useTour } from "@/components/tour/TourProvider";
import { useRecentActionsStore } from "@/stores/recentActionsStore";
import { UndoButton } from "@/components/UndoToast";
import {
  setFirstRunCompleted,
  setTourCompleted,
} from "@/lib/firstRun";

/**
 * G19 — Settings.
 *
 * Surfaces the on-ramp affordances: replay the boot/tour, the Plain
 * English toggle, and the session-scoped Recent Actions list (B10).
 */
export default function Settings() {
  const tour = useTour();
  const actions = useRecentActionsStore((s) => s.actions);
  const clear = useRecentActionsStore((s) => s.clear);

  // Allow other parts of the app to register the Settings link in the tour.
  useEffect(() => {
    document.title = "Briefcase — Settings";
  }, []);

  const formatTime = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    [],
  );

  const replayBoot = () => {
    setFirstRunCompleted(false);
    setTourCompleted(false);
    window.location.assign(`${import.meta.env.BASE_URL}cases`);
  };

  const replayTour = () => {
    setTourCompleted(false);
    tour.start();
  };

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-24"
      data-testid="settings-screen"
    >
      <AuroraBackground />
      <GlassAppBar
        title="Settings"
        subtitle="Personalize Briefcase"
        backHref="/cases"
        backLabel="Back to cases"
      />

      <section className="mt-2 flex flex-col gap-4">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Plain English</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When on, legal jargon is replaced with everyday-words versions.
            Tap any term to see the legal phrase.
          </p>
          <div className="mt-3">
            <PlainEnglishToggle />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">First-run experience</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Replay the boot animation, persona introductions, or the
            spotlight tour.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={replayBoot}
              data-testid="replay-boot"
            >
              <RotateCcw className="size-4" />
              Replay boot &amp; intros
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={replayTour}
              data-testid="replay-tour"
            >
              <RotateCcw className="size-4" />
              Replay tour
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Recent actions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Things you can still undo from this session.
              </p>
            </div>
            {actions.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clear}
                data-testid="clear-recent-actions"
              >
                <Trash2 className="size-4" />
                Clear
              </Button>
            )}
          </header>

          <div className="mt-3" data-testid="recent-actions-list">
            {actions.length === 0 ? (
              <EmptyState
                variant="messages"
                title="No recent actions"
                description="Destructive actions show up here so you can undo them."
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {actions.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 py-2"
                    data-testid={`recent-action-${a.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {a.label}{" "}
                        {a.undone && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-600">
                            undone
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatTime.format(a.timestamp)}
                      </p>
                    </div>
                    <UndoButton id={a.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Need help? <Link href="/cases" className="underline">Go back to cases</Link>
        </p>
      </section>
    </main>
  );
}
