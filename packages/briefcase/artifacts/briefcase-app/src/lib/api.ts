import { QueryClient } from "@tanstack/react-query";
import type { CustomFetchOptions } from "@workspace/api-client-react";

/**
 * The buildathon demo flow always sends `x-demo-user: demo_user_pd`.
 * Every generated React Query hook accepts a `request` second argument
 * (see Orval's `SecondParameter<typeof customFetch>`); we pass this
 * constant in via `useApi()` so the demo identity travels with every call.
 */
export const apiRequestOptions: CustomFetchOptions = {
  headers: {
    "x-demo-user": "demo_user_pd",
  },
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
