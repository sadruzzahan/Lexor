import { apiRequestOptions } from "@/lib/api";
import { isDemoLawyer, setDemoLawyer } from "@/lib/auth";

/**
 * Thin provider-style hook used by every page that talks to the API.
 *
 * Each generated React Query hook accepts `{ request }` as a second-arg;
 * call sites do `useListCases(undefined, { request })` so the
 * `x-demo-user` header rides along automatically.
 */
export function useApi() {
  return {
    request: apiRequestOptions,
    isDemoLawyer: isDemoLawyer(),
    setDemoLawyer,
  };
}
