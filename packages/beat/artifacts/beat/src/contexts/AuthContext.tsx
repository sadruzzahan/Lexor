import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";

interface AuthUser {
  id: string;
  displayName: string;
  email: string | null;
  tier: "free" | "agency";
}

interface AuthContextValue {
  userId: string | null;
  user: AuthUser | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  userId: null,
  user: null,
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, userId: clerkUserId } = useClerkAuth();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !clerkUserId) {
      setUser(null);
      localStorage.removeItem("userId");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`/auth/me responded ${r.status}`);
        }
        return r.json() as Promise<AuthUser>;
      })
      .then((data) => {
        setUser(data);
        localStorage.setItem("userId", data.id);
      })
      .catch(() => {
        const fallback: AuthUser = { id: clerkUserId, displayName: "Detective", email: null, tier: "free" };
        setUser(fallback);
        localStorage.setItem("userId", clerkUserId);
      })
      .finally(() => setIsLoading(false));
  }, [isLoaded, isSignedIn, clerkUserId]);

  const value: AuthContextValue = {
    userId: user?.id ?? clerkUserId ?? null,
    user,
    isLoading: !isLoaded || isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser() {
  return useContext(AuthContext);
}
