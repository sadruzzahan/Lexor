import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { Toaster } from "sonner";
import { useDisclaimer } from "@/lib/disclaimer";
import {
  MapPin,
  Users2,
  Building2,
  PhoneCall,
  Scale,
} from "lucide-react";
import { I18nProvider } from "@/lib/i18n";
import { Shell } from "@/components/layout/Shell";
import { DisclaimerModal } from "@/components/DisclaimerModal";
import { CommandPalette } from "@/components/CommandPalette";
import Home from "@/pages/Home";
import About from "@/pages/About";
import DisclaimerPage from "@/pages/Disclaimer";
import UploadPage from "@/pages/Upload";
import CasePage from "@/pages/Case";
import { Soon } from "@/pages/Soon";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/c/:caseId" component={CasePage} />
      <Route path="/map">
        <Soon titleKey="page.map.title" Icon={MapPin} />
      </Route>
      <Route path="/coalition/:id">
        <Soon titleKey="page.coalition.title" Icon={Users2} />
      </Route>
      <Route path="/entity/:id">
        <Soon titleKey="page.entity.title" Icon={Building2} />
      </Route>
      <Route path="/voice">
        <Soon titleKey="page.voice.title" Icon={PhoneCall} />
      </Route>
      <Route path="/rights/:vertical">
        <Soon titleKey="page.rights.title" Icon={Scale} />
      </Route>
      <Route path="/about" component={About} />
      <Route path="/legal/disclaimer" component={DisclaimerPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const heartbeat = useDisclaimer((s) => s.heartbeat);
  useEffect(() => {
    heartbeat();
    const onVisible = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [heartbeat]);
  return (
    <I18nProvider>
      <WouterRouter base={base}>
        <Shell>
          <Router />
        </Shell>
        <DisclaimerModal />
        <CommandPalette />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
              color: "var(--color-fg)",
            },
          }}
        />
      </WouterRouter>
    </I18nProvider>
  );
}

export default App;
