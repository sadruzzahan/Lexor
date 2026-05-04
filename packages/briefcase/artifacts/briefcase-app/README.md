# Briefcase (web)

Briefcase is the JusticeOS criminal-defense copilot. The 2026-05-02 scope
pivot retargeted the original Expo build to a **React + Vite web app**;
this artifact is the result of gate **G4 — Briefcase Mobile Scaffold**
re-interpreted for web (per `replit.md`).

The artifact directory is `artifacts/briefcase-app/` and it is served at
`/briefcase-app`. The earlier `artifacts/briefcase/` slug had to be
abandoned because the platform's workflow port watcher would not detect
its dev server; see `replit.md` → "Slug history".

## What's in here

- Wouter-based routing matching the spec's `(onboarding)` and `(app)`
  Expo route groups.
- A welcome screen with a "Continue as Demo Lawyer" CTA that persists a
  `demoLawyer` flag in `localStorage` and routes into `/cases`.
- A cases home page (`/cases`) that calls the generated React Query hook
  `useListCases` from `@workspace/api-client-react`, sending the demo
  identity via the `x-demo-user: demo_user_pd` header.
- A reusable `CaseCard` component, a floating action button (no-op in
  G4), and an empty state with the spec copy
  _"No cases yet — tap + to start"_.
- A `useApi()` hook that surfaces the demo-request options + the
  demo-lawyer flag setter.

## Out of scope (per task G4)

- 4-pane Briefcase view (G5).
- Drive sign-in / camera (G8 / G9).
- Liquid Glass tab bar polish (G10 / G17).

## Stack mapping (Expo → Web)

The original spec §4.1 assumed an Expo / React Native stack. Under the
web-only pivot the equivalents are:

| Spec dependency        | Web equivalent used here                |
| ---------------------- | --------------------------------------- |
| Expo SDK 54 + Router 4 | Vite + Wouter                           |
| NativeWind v4          | Tailwind CSS v4 (already configured)    |
| gluestack-ui v3        | shadcn/ui (Radix) primitives            |
| Reanimated 4 + Moti    | Framer Motion (G17 will lean on this)   |
| react-native-skia      | Canvas / SVG (deferred to G17 / G18)    |
| FlashList v2           | Plain `<ul>` for v1 (≤ 100 items)       |
| Gorhom bottom sheet    | shadcn `Drawer` / `Sheet` (G5)          |
| react-native-sse       | Native `EventSource` (G5)               |
| MMKV / AsyncStorage    | `localStorage`                          |
| TanStack Query v5      | TanStack Query v5 (unchanged)           |
| Zustand                | Zustand (unchanged, lands when needed)  |
| AI SDK 5 + AI Elements | AI SDK + `ai-elements` (lands in G5)    |
| EAS dev build          | Not required — Replit Publish handles deploy |

## Local development

```bash
pnpm --filter @workspace/briefcase-app run dev    # Vite dev server
pnpm --filter @workspace/briefcase-app run build  # production bundle
pnpm --filter @workspace/briefcase-app run typecheck
```

The artifact is registered with `previewPath: /briefcase-app`, and Vite
serves the bundle under base `/briefcase-app/` (BASE_PATH env), so the
dev preview is available at `${REPLIT_DEV_DOMAIN}/briefcase-app/`. API
calls go to the shared `@workspace/api-server` artifact at `/api/...`
via the workspace proxy.
