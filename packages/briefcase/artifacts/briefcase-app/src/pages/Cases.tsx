import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useListCases } from "@workspace/api-client-react";
import CaseCard from "@/components/CaseCard";
import EmptyState from "@/components/EmptyState";
import Fab from "@/components/Fab";
import ScanSheet from "@/components/ScanSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonMorph } from "@/components/SkeletonMorph";
import { useApi } from "@/hooks/useApi";
import { GlassAppBar } from "@/components/GlassAppBar";
import { AuroraBackground } from "@/components/AuroraBackground";
import { useTour } from "@/components/tour/TourProvider";
import { tourCompleted } from "@/lib/firstRun";
import { PRACTICE_CASE_ID, PRACTICE_CASE_TITLE } from "@/hooks/usePracticeRun";

export default function Cases() {
  const { request } = useApi();
  const [, setLocation] = useLocation();
  const [scanOpen, setScanOpen] = useState(false);
  const tour = useTour();

  const { data, isLoading, isError } = useListCases(undefined, {
    request,
  });

  const cases = data?.items ?? [];
  // The cases endpoint isn't live until G3 lands; until then we surface
  // the friendly empty state instead of a hard error.
  const showEmpty = !isLoading && (cases.length === 0 || isError);

  // G19 / B3 — register tour steps + auto-start on first visit.
  useEffect(() => {
    tour.setSteps([
      {
        testId: "fab-new-case",
        text: "Tap + to start a new case from a scan or upload.",
      },
      {
        testId: "open-settings",
        text: "Settings holds Plain English, the tour replay, and recent actions.",
      },
      ...(showEmpty
        ? [
            {
              testId: "try-practice-case",
              text: "No real case yet? Try the practice case — runs entirely on your device.",
            },
          ]
        : [
            {
              testId: `case-card-${cases[0]?.id}`,
              text: "Open any case to see the AI dashboard in action.",
            },
          ]),
    ]);
  }, [tour, showEmpty, cases]);

  useEffect(() => {
    if (isLoading || tourCompleted()) return;
    const id = window.setTimeout(() => tour.start(), 600);
    return () => window.clearTimeout(id);
  }, [isLoading, tour]);

  const launchPractice = () => {
    setLocation(`/case/${PRACTICE_CASE_ID}`);
  };

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-24"
      data-testid="cases-screen"
    >
      <AuroraBackground />
      <GlassAppBar
        title="Cases"
        subtitle="Your active matters and recent activity."
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/settings")}
            data-testid="open-settings"
            aria-label="Open settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        }
      />

      <SkeletonMorph
        loading={isLoading}
        testId="cases-morph"
        skeleton={
          <ul
            className="flex flex-col gap-3"
            data-testid="cases-loading"
            aria-label="Loading cases"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i}>
                <Skeleton className="h-24 w-full rounded-lg" />
              </li>
            ))}
          </ul>
        }
      >
        {showEmpty ? (
          <EmptyState
            variant="cases"
            action={
              <Button
                onClick={launchPractice}
                data-testid="try-practice-case"
              >
                <Sparkles className="size-4" />
                Try a sample case — {PRACTICE_CASE_TITLE}
              </Button>
            }
          />
        ) : (
          <ul
            className="flex flex-col gap-3"
            data-testid="cases-list"
            aria-label="Cases"
          >
            {cases.map((c, i) => (
              <li key={c.id} data-testid={`case-card-${c.id}`}>
                <CaseCard
                  caseRecord={c}
                  onClick={() => setLocation(`/case/${c.id}`)}
                />
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                size="sm"
                onClick={launchPractice}
                data-testid="try-practice-case"
                className="w-full justify-center text-xs text-muted-foreground"
              >
                <Sparkles className="size-4" />
                Or open the practice case — {PRACTICE_CASE_TITLE}
              </Button>
            </li>
          </ul>
        )}
      </SkeletonMorph>

      <Fab
        onClick={() => setScanOpen(true)}
        label="Scan documents"
      />

      <ScanSheet open={scanOpen} onOpenChange={setScanOpen} />
    </main>
  );
}
