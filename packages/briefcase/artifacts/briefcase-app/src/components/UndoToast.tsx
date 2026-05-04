import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRecentActionsStore } from "@/stores/recentActionsStore";

/**
 * G19 / B10 — Universal Undo.
 *
 * `showUndoToast({ label, onUndo })` fires a 5 s sonner toast with an Undo
 * button. The action is also pushed onto the session-scoped Recent Actions
 * store so Settings → Recent Actions can re-offer Undo for a while after.
 *
 * `setupGlobalUndoShortcut()` wires ⌘Z / Ctrl-Z to undo the most-recent
 * undoable action (matches the spec's iPad-keyboard requirement).
 */

interface UndoToastOptions {
  label: string;
  onUndo: () => void;
  /** Optional explicit id — defaults to a random uuid. */
  id?: string;
  /** Optional dismissal hook (e.g. perform the destructive action permanently). */
  onCommit?: () => void;
}

export function showUndoToast({
  label,
  onUndo,
  id,
  onCommit,
}: UndoToastOptions): string {
  const actionId = id ?? crypto.randomUUID();
  const store = useRecentActionsStore.getState();

  let undone = false;
  const wrappedUndo = () => {
    if (undone) return;
    undone = true;
    onUndo();
  };

  store.push({ id: actionId, label, undo: wrappedUndo });

  toast(label, {
    id: actionId,
    duration: 5000,
    action: {
      label: "Undo",
      onClick: () => {
        useRecentActionsStore.getState().performUndo(actionId);
      },
    },
    onDismiss: () => {
      if (!undone) onCommit?.();
    },
    onAutoClose: () => {
      if (!undone) onCommit?.();
    },
  });

  return actionId;
}

/** Imperative variant for non-toast renderers (e.g. Recent Actions screen). */
export function UndoButton({ id }: { id: string }) {
  const action = useRecentActionsStore((s) =>
    s.actions.find((a) => a.id === id),
  );
  const performUndo = useRecentActionsStore((s) => s.performUndo);
  if (!action) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={action.undone || !action.undo}
      onClick={() => performUndo(id)}
      data-testid={`undo-${id}`}
    >
      {action.undone ? "Undone" : "Undo"}
    </Button>
  );
}

let installed = false;

/**
 * Install ⌘Z / Ctrl-Z. Idempotent — safe to call from React effects on
 * every render. We deliberately only undo the *most recent* still-undoable
 * action so the shortcut behaves like a stack pop.
 */
export function setupGlobalUndoShortcut(): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed) return () => {};
  installed = true;

  const handler = (e: KeyboardEvent) => {
    const isUndo =
      (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z");
    if (!isUndo) return;
    const target = e.target as HTMLElement | null;
    // Don't steal undo from text editors.
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        (target as HTMLElement).isContentEditable)
    ) {
      return;
    }
    const next = useRecentActionsStore
      .getState()
      .actions.find((a) => !a.undone && a.undo);
    if (!next) return;
    e.preventDefault();
    useRecentActionsStore.getState().performUndo(next.id);
    toast.success(`Undone: ${next.label}`);
  };
  window.addEventListener("keydown", handler);
  return () => {
    window.removeEventListener("keydown", handler);
    installed = false;
  };
}
