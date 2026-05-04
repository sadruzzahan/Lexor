// Runtime Zod schemas for request/response validation. Use `z.infer<typeof X>`
// when you need the TypeScript type derived from a schema.
//
// We deliberately do NOT re-export `./generated/types/*` here because Orval
// emits some param types (e.g. `StreamRunEventsParams`) under the same name as
// runtime zod schemas in `./generated/api`, which causes ambiguous-export
// errors. Plain TypeScript types live in `@workspace/api-client-react` for
// frontend code, and backend code can derive them from the zod schemas.
export * from "./generated/api";
