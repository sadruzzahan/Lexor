import { useLocation } from "wouter";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/useApi";

export default function Welcome() {
  const [, setLocation] = useLocation();
  const { setDemoLawyer } = useApi();

  function handleContinue() {
    setDemoLawyer(true);
    setLocation("/cases");
  }

  return (
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-6"
      data-testid="welcome-screen"
    >
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <Briefcase className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Briefcase
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          An AI copilot for criminal defense. Sign in to your demo persona to
          explore cases, evidence, and the JusticeOS engine.
        </p>
        <Button
          size="lg"
          className="mt-8 w-full"
          onClick={handleContinue}
          data-testid="continue-as-demo-lawyer"
        >
          Continue as Demo Lawyer
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          You'll be signed in as <code className="font-mono">demo_user_pd</code>.
        </p>
      </div>
    </main>
  );
}
