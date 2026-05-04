import { useLocation } from "wouter";
import { ShieldX } from "lucide-react";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <ShieldX className="h-12 w-12 text-muted-foreground/40" />
        <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">404</h1>
        <p className="text-sm text-muted-foreground font-mono">Page not found</p>
        <button
          onClick={() => navigate("/investigations")}
          className="mt-2 text-xs font-mono text-primary hover:text-primary/80 underline underline-offset-4 transition-colors"
          data-testid="link-go-home"
        >
          Back to Investigations
        </button>
      </div>
    </div>
  );
}
