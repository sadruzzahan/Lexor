import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Welcome from "@/pages/Welcome";
import Cases from "@/pages/Cases";
import CaseDetail from "@/pages/CaseDetail";
import SourceViewer from "@/pages/SourceViewer";
import Contradictions from "@/pages/Contradictions";
import Rights from "@/pages/Rights";
import Brady from "@/pages/Brady";
import Jury from "@/pages/Jury";
import Plea from "@/pages/Plea";
import Adversarial from "@/pages/Adversarial";
import Courtroom from "@/pages/Courtroom";
import Agent from "@/pages/Agent";
import Settings from "@/pages/Settings";
import { queryClient } from "@/lib/api";
import { isDemoLawyer } from "@/lib/auth";
import { AmbientReactor } from "@/components/aurora/AmbientReactor";
import { useOledTrueBlack } from "@/hooks/useOledTrueBlack";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import BootSequence from "@/components/boot/BootSequence";
import { TourProvider } from "@/components/tour/TourProvider";
import { PlainEnglishProvider } from "@/components/plain-english/PlainEnglishProvider";
import {
  firstRunCompleted,
  setFirstRunCompleted,
} from "@/lib/firstRun";
import { setupGlobalUndoShortcut } from "@/components/UndoToast";

function OnboardingRoute() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isDemoLawyer()) {
      setLocation("/cases", { replace: true });
    }
  }, [setLocation]);

  if (isDemoLawyer()) return null;
  return <Welcome />;
}

function AppRoute({ children }: { children: React.ReactNode }) {
  if (!isDemoLawyer()) {
    return <Redirect to="/" replace />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={OnboardingRoute} />
      <Route path="/cases">
        <AppRoute>
          <Cases />
        </AppRoute>
      </Route>
      <Route path="/case/:id">
        {(params) => (
          <AppRoute>
            <CaseDetail key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/source/:fileId">
        {(params) => (
          <AppRoute>
            <SourceViewer key={`${params.id}/${params.fileId}`} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/contradictions">
        {(params) => (
          <AppRoute>
            <Contradictions key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/rights">
        {(params) => (
          <AppRoute>
            <Rights key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/brady">
        {(params) => (
          <AppRoute>
            <Brady key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/jury">
        {(params) => (
          <AppRoute>
            <Jury key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/plea">
        {(params) => (
          <AppRoute>
            <Plea key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/adversarial">
        {(params) => (
          <AppRoute>
            <Adversarial key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/agent">
        {(params) => (
          <AppRoute>
            <Agent key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/case/:id/courtroom">
        {(params) => (
          <AppRoute>
            <Courtroom key={params.id} />
          </AppRoute>
        )}
      </Route>
      <Route path="/settings">
        <AppRoute>
          <Settings />
        </AppRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function VisualChrome({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [activity, setActivity] = useState(0.5);
  const trueBlack = useOledTrueBlack({ activity, reducedMotion: reduced });

  return (
    <>
      <AmbientReactor trueBlack={trueBlack} onActivity={setActivity} />
      {children}
    </>
  );
}

/**
 * G19 / B1 — gate first paint behind the boot sequence on first launch.
 * Once `firstRunCompleted` is set, this collapses to a passthrough.
 */
function FirstRunGate({ children }: { children: React.ReactNode }) {
  const [showBoot, setShowBoot] = useState<boolean | null>(null);

  useEffect(() => {
    setShowBoot(!firstRunCompleted());
  }, []);

  if (showBoot === null) return null;

  return (
    <>
      {showBoot && (
        <BootSequence
          onComplete={() => {
            setFirstRunCompleted(true);
            setShowBoot(false);
          }}
        />
      )}
      {children}
    </>
  );
}

function App() {
  // ⌘Z / Ctrl-Z global undo shortcut.
  useEffect(() => setupGlobalUndoShortcut(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PlainEnglishProvider>
          <TourProvider>
            <VisualChrome>
              <FirstRunGate>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
              </FirstRunGate>
            </VisualChrome>
          </TourProvider>
        </PlainEnglishProvider>
        <Toaster />
        <SonnerToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
