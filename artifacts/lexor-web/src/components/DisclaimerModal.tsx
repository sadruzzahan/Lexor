import * as Dialog from "@radix-ui/react-dialog";
import { useDisclaimer } from "@/lib/disclaimer";
import { useT } from "@/lib/i18n";

export function DisclaimerModal() {
  const open = useDisclaimer((s) => s.open);
  const acknowledge = useDisclaimer((s) => s.acknowledge);
  const { t } = useT();

  return (
    <Dialog.Root open={open} modal>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
          onClick={(e) => e.preventDefault()}
        />
        <Dialog.Content
          role="alertdialog"
          aria-labelledby="lexor-disc-title"
          aria-describedby="lexor-disc-body"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,92vw)] rounded-lg2 border border-border-strong bg-bg-elevated p-6 sm:p-7 shadow-2xl"
          data-testid="modal-disclaimer"
        >
          <Dialog.Title
            id="lexor-disc-title"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            {t("modal.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("modal.body.lead")}
          </Dialog.Description>

          <div id="lexor-disc-body" className="mt-4 space-y-3 text-sm leading-relaxed text-fg-muted">
            <p className="text-fg">{t("modal.body.lead")}</p>
            <ol className="space-y-2 list-decimal list-inside">
              <li>
                <span className="font-semibold text-fg">{t("modal.body.p1.head")}</span>{" "}
                {t("modal.body.p1.text")}
              </li>
              <li>
                <span className="font-semibold text-fg">{t("modal.body.p2.head")}</span>{" "}
                {t("modal.body.p2.text")}
              </li>
              <li>
                <span className="font-semibold text-fg">{t("modal.body.p3.head")}</span>{" "}
                {t("modal.body.p3.text")}
              </li>
            </ol>
            <p className="pt-1">{t("modal.body.tail")}</p>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={acknowledge}
              className="shimmer-btn rounded-base px-5 py-2.5 text-sm font-medium"
              data-testid="button-disclaimer-ack"
              autoFocus
            >
              {t("modal.cta")}
            </button>
          </div>

          <p className="mt-4 text-[11px] text-fg-subtle font-mono">
            {t("modal.version")}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
