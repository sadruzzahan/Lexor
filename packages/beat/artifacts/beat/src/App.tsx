import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BottomNav } from "@/components/BottomNav";
import { TierBanner } from "@/components/TierBanner";
import { RecordingIndicator } from "@/components/RecordingIndicator";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { AuthProvider } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";
import Welcome from "@/pages/welcome";
import Investigations from "@/pages/investigations";
import NewInvestigation from "@/pages/new-investigation";
import BeatView from "@/pages/beat-view";
import AgentInspector from "@/pages/agent-inspector";
import Settings from "@/pages/settings";
import ShareView from "@/pages/share-view";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl: string =
  import.meta.env.VITE_CLERK_PROXY_URL ?? `${basePath}/api/__clerk`;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#00FF88",
    colorForeground: "#E8F0EC",
    colorMutedForeground: "#6B7C74",
    colorDanger: "#FF4D4D",
    colorBackground: "#0D1810",
    colorInput: "#131F16",
    colorInputForeground: "#E8F0EC",
    colorNeutral: "#1E2E23",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !rounded-none",
    headerTitle: "text-[#E8F0EC] font-bold",
    headerSubtitle: "text-[#6B7C74]",
    socialButtonsBlockButtonText: "text-[#E8F0EC]",
    formFieldLabel: "text-[#A8BAB0]",
    footerActionLink: "text-[#00FF88] hover:text-[#00CC6A]",
    footerActionText: "text-[#6B7C74]",
    dividerText: "text-[#6B7C74]",
    identityPreviewEditButton: "text-[#00FF88]",
    formFieldSuccessText: "text-[#00FF88]",
    alertText: "text-[#E8F0EC]",
    logoBox: "flex justify-center mb-2",
    logoImage: "w-12 h-12",
    socialButtonsBlockButton: "border-[#1E2E23] hover:border-[#00FF88]/40 bg-[#131F16]",
    formButtonPrimary: "bg-[#00FF88] text-[#0A0F0C] hover:bg-[#00CC6A] font-semibold",
    formFieldInput: "bg-[#131F16] border-[#1E2E23] text-[#E8F0EC] focus:border-[#00FF88]",
    footerAction: "bg-[#0A0F0C]/60",
    dividerLine: "bg-[#1E2E23]",
    alert: "bg-[#1E2E23]",
    otpCodeFieldInput: "bg-[#131F16] border-[#1E2E23] text-[#E8F0EC]",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, #0A0F0C 0%, #0D1810 60%, #0A0F0C 100%)" }}
    >
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, #0A0F0C 0%, #0D1810 60%, #0A0F0C 100%)" }}
    >
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/investigations" />
      </Show>
      <Show when="signed-out">
        <Welcome />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AppShell() {
  const [location] = useLocation();
  const isShareRoute = location.startsWith("/share/");
  const isAuthRoute = location.startsWith("/sign-in") || location.startsWith("/sign-up");

  return (
    <>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/investigations" component={() => <ProtectedRoute component={Investigations} />} />
        <Route path="/investigations/new" component={() => <ProtectedRoute component={NewInvestigation} />} />
        <Route path="/investigations/:id/agent" component={() => <ProtectedRoute component={AgentInspector} />} />
        <Route path="/investigations/:id" component={() => <ProtectedRoute component={BeatView} />} />
        <Route path="/share/:token" component={ShareView} />
        <Route path="/me" component={() => <ProtectedRoute component={Settings} />} />
        <Route component={NotFound} />
      </Switch>
      {!isShareRoute && !isAuthRoute && (
        <Show when="signed-in">
          <BottomNav />
          <TierBanner />
          <RecordingIndicator />
        </Show>
      )}
    </>
  );
}

function ClerkProviderWithApp() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey ?? ""}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back, Detective",
            subtitle: "Sign in to access your investigations",
          },
        },
        signUp: {
          start: {
            title: "Join Beat",
            subtitle: "Create your detective account",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <AuthProvider>
          <TooltipProvider>
            <RecordingProvider>
              <AppShell />
            </RecordingProvider>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithApp />
    </WouterRouter>
  );
}

export default App;
