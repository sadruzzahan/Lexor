import { Link, useLocation } from "wouter";
import { FolderKanban, PlusCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const [location] = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex justify-around items-center h-16 px-4 md:hidden"
      aria-label="Main navigation"
    >
      <Link
        href="/investigations"
        className={cn(
          "flex flex-col items-center justify-center w-full h-full text-xs gap-1",
          location === "/investigations" ? "text-primary" : "text-muted-foreground",
        )}
        aria-label="Investigations"
        aria-current={location === "/investigations" ? "page" : undefined}
        data-testid="nav-investigations"
      >
        <FolderKanban className="h-5 w-5" aria-hidden="true" />
        <span>Investigations</span>
      </Link>

      <Link
        href="/investigations/new"
        className="flex flex-col items-center justify-center w-full h-full text-xs gap-1 text-muted-foreground"
        aria-label="New investigation"
        data-testid="nav-capture"
      >
        <div className="bg-primary text-primary-foreground rounded-full p-2 -mt-6 border-4 border-background">
          <PlusCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <span>Capture</span>
      </Link>

      <Link
        href="/me"
        className={cn(
          "flex flex-col items-center justify-center w-full h-full text-xs gap-1",
          location === "/me" ? "text-primary" : "text-muted-foreground",
        )}
        aria-label="Profile and settings"
        aria-current={location === "/me" ? "page" : undefined}
        data-testid="nav-me"
      >
        <User className="h-5 w-5" aria-hidden="true" />
        <span>Me</span>
      </Link>
    </nav>
  );
}
