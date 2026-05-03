import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Inbox,
  PhoneCall,
  ShieldAlert,
  Send,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Beaker,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/hooks";
import { BRAND } from "@/lib/brand";
import { RevealText } from "@/components/RevealText";
import {
  getInboxStatus,
  enableInboxWatch,
  disableInboxWatch,
  listInboxAlerts,
  ingestTestEmail,
  resolveInboxAlert,
  sendInboxReply,
  type InboxStatus,
  type InboxAlert,
  type InboxIngestResult,
} from "@/lib/api";

const SAMPLE_EVICTION = {
  fromDisplay: "Greenway Apartments LLC",
  fromAddress: "leases@greenway.example.com",
  subject: "NOTICE TO QUIT — 3-Day Pay or Quit, Unit 4B",
  bodyText: `Tenant,

You are hereby served with this 3-DAY NOTICE TO PAY RENT OR QUIT.
Past-due rent: $2,400 for the month of April 2026. You must pay in
full or vacate the premises within three (3) days of service of this
notice. Failure to comply will result in the filing of an unlawful
detainer action without further notice.

Greenway Apartments LLC
Property Manager
`,
};

// Parse `#alert=<uuid>` from the current URL. Used by the voice tool
// open_case_on_device which texts the caller a deeplink like
// /lexor/settings#alert=<uuid> so they can review the drafted reply on
// their phone. If present, we scroll the alert into view and open its
// "Drafted reply" details panel.
function readAlertHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = /(?:^|[#&])alert=([0-9a-f-]{36})/i.exec(window.location.hash);
  return m?.[1] ?? null;
}

export default function SettingsPage() {
  useDocumentTitle(`Inbox Sentinel · Settings · ${BRAND.name}`);
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<InboxAlert[]>([]);
  const [highlightAlertId, setHighlightAlertId] = useState<string | null>(
    () => readAlertHash(),
  );
  const [phone, setPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [lastTest, setLastTest] = useState<InboxIngestResult | null>(null);

  // Initial + 5s polling refresh of status + alerts. The voice/in-app
  // dispatch latency is sub-second, so 5s is plenty for the demo.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [s, a] = await Promise.all([getInboxStatus(), listInboxAlerts()]);
        if (cancelled) return;
        setStatus(s);
        if (s.watch?.phoneNumber && !phone) setPhone(s.watch.phoneNumber);
        setAlerts(a);
        setStatusErr(null);
      } catch (e) {
        if (cancelled) return;
        setStatusErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setSavingPhone(true);
    try {
      await enableInboxWatch({ phoneNumber: phone || null });
      const s = await getInboxStatus();
      setStatus(s);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPhone(false);
    }
  }

  async function handleDisable() {
    await disableInboxWatch();
    const s = await getInboxStatus();
    setStatus(s);
  }

  async function handleTest() {
    setTestRunning(true);
    setLastTest(null);
    try {
      const res = await ingestTestEmail(SAMPLE_EVICTION);
      setLastTest(res);
      const a = await listInboxAlerts();
      setAlerts(a);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTestRunning(false);
    }
  }

  async function handleDismiss(id: string) {
    await resolveInboxAlert(id, "dismissed");
    const a = await listInboxAlerts();
    setAlerts(a);
  }

  async function handleSend(id: string) {
    try {
      await sendInboxReply(id);
      const a = await listInboxAlerts();
      setAlerts(a);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (statusErr && status === null) {
    return (
      <section className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <div className="rounded-xl border border-red-700/40 bg-red-900/20 p-6 text-red-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-none" />
          <div>
            <div className="font-semibold mb-1">Sign in required</div>
            <p className="text-sm text-red-200/80">
              Inbox Sentinel binds an inbox to your account, so you need to
              be signed in. {statusErr}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="mx-auto max-w-3xl px-4 sm:px-6 py-12 text-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-4 sm:px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="flex items-center gap-2 text-accent text-xs uppercase tracking-widest mb-2">
          <Inbox className="h-3.5 w-3.5" />
          <span>Stretch · Feature 8</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tight">
          Inbox Sentinel
        </h1>
        <RevealText as="p" className="mt-3 text-fg-muted max-w-2xl">
          {`When something legally significant lands in your inbox — an eviction notice, a court summons, a debt collector, an IRS notice, an immigration action, a termination — ${BRAND.name} interrupts you within 60 seconds, reads the gist, and offers to send a reply.`}
        </RevealText>
      </header>

      <ConnectionCard
        status={status}
        phone={phone}
        setPhone={setPhone}
        savingPhone={savingPhone}
        onEnable={handleEnable}
        onDisable={handleDisable}
      />

      <TestCard
        running={testRunning}
        lastTest={lastTest}
        onTest={handleTest}
      />

      <AlertsList
        alerts={alerts}
        onDismiss={handleDismiss}
        onSend={handleSend}
        canSend={status.connectorReady}
        highlightAlertId={highlightAlertId}
        onHighlightConsumed={() => setHighlightAlertId(null)}
      />

      <DisclaimerStrip />
    </section>
  );
}

function ConnectionCard(props: {
  status: InboxStatus;
  phone: string;
  setPhone: (s: string) => void;
  savingPhone: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const { status, phone, setPhone, savingPhone, onEnable, onDisable } = props;
  const enabled = Boolean(status.watch?.enabled);
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-6 sm:p-8 mb-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-fg-muted mb-1">
            <Mail className="h-3.5 w-3.5" />
            <span>Gmail connection</span>
          </div>
          <div className="font-display text-2xl">
            {status.connectedEmail ?? "Not connected"}
          </div>
        </div>
        <span
          className={`text-xs font-mono px-2 py-1 rounded ${
            status.connectorReady
              ? "bg-accent/15 text-accent"
              : "bg-amber-900/30 text-amber-200"
          }`}
        >
          {status.connectorReady ? "READY" : "NOT CONNECTED"}
        </span>
      </div>

      {!status.connectorReady && (
        <div className="mb-5 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
          Open the Replit integrations panel and connect Gmail to activate the
          sentinel. You can still try the test fixture below without a
          connected inbox.
        </div>
      )}
      {enabled && (
        <div className="mb-5 rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs text-fg-muted">
          Read-only access. {BRAND.name} only reads enough to classify each
          message and never stores the original body. Click{" "}
          <strong className="text-fg">Disable</strong> any time to immediately
          stop polling — for a full revoke, also disconnect Gmail in the
          Replit integrations panel.
        </div>
      )}

      <label className="block text-xs text-fg-muted mb-2">
        Your phone number (E.164 — e.g. +14155551234)
      </label>
      <div className="flex gap-3">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+14155551234"
          className="flex-1 rounded-base border border-border bg-bg px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent"
          data-testid="input-phone"
        />
        {enabled ? (
          <button
            type="button"
            onClick={onDisable}
            className="ghost-btn px-4 py-2 rounded-base text-sm"
            data-testid="button-disable-sentinel"
          >
            Disable
          </button>
        ) : (
          <button
            type="button"
            onClick={onEnable}
            disabled={savingPhone}
            className="px-4 py-2 rounded-base text-sm bg-accent text-accent-fg font-medium disabled:opacity-50"
            data-testid="button-enable-sentinel"
          >
            {savingPhone ? "Saving…" : "Enable sentinel"}
          </button>
        )}
      </div>

      <div className="mt-5 grid sm:grid-cols-2 gap-3 text-xs">
        <Pill
          ok={status.twilioConfigured}
          okLabel="Outbound calls ready"
          notLabel="Outbound calls degraded → in-app alerts"
        />
        <Pill
          ok={status.connectorReady}
          okLabel="Gmail send ready"
          notLabel="Gmail send unavailable"
        />
      </div>
    </div>
  );
}

function Pill({
  ok,
  okLabel,
  notLabel,
}: {
  ok: boolean;
  okLabel: string;
  notLabel: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-base px-3 py-2 ${
        ok
          ? "bg-accent/10 text-accent"
          : "bg-amber-900/20 text-amber-200"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      <span>{ok ? okLabel : notLabel}</span>
    </div>
  );
}

function TestCard(props: {
  running: boolean;
  lastTest: InboxIngestResult | null;
  onTest: () => void;
}) {
  const { running, lastTest, onTest } = props;
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-6 sm:p-8 mb-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-fg-muted mb-2">
        <Beaker className="h-3.5 w-3.5" />
        <span>Try it now</span>
      </div>
      <div className="font-display text-xl mb-1">Send the sentinel a test eviction notice</div>
      <p className="text-sm text-fg-muted mb-5">
        We&apos;ll feed a synthetic 3-day pay-or-quit notice through the same
        classifier and alert pipeline a real Gmail message would hit.
      </p>
      <button
        type="button"
        onClick={onTest}
        disabled={running}
        className="px-4 py-2 rounded-base bg-accent text-accent-fg font-medium text-sm disabled:opacity-50 inline-flex items-center gap-2"
        data-testid="button-run-test"
      >
        {running ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Classifying…
          </>
        ) : (
          <>
            <ShieldAlert className="h-4 w-4" /> Run sentinel test
          </>
        )}
      </button>

      <AnimatePresence>
        {lastTest && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-5 rounded-lg border border-border bg-bg p-4 text-sm space-y-2"
          >
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-mono uppercase text-xs tracking-widest">
                {lastTest.category ?? "no_match"} ·{" "}
                {Math.round(lastTest.confidence * 100)}% confidence
              </span>
            </div>
            {lastTest.gist && <p className="text-fg">{lastTest.gist}</p>}
            {lastTest.deadlineIso && (
              <p className="text-fg-muted">
                Deadline detected: <span className="font-mono">{lastTest.deadlineIso}</span>
              </p>
            )}
            {lastTest.dispatch && (
              <p className="text-xs text-fg-muted">
                Dispatched via {lastTest.dispatch.channel.replace("_", "-")} in{" "}
                <span className="font-mono">{lastTest.dispatch.dispatchLatencyMs}ms</span>
                {lastTest.dispatch.callSid
                  ? ` · CallSid ${lastTest.dispatch.callSid}`
                  : ""}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AlertsList(props: {
  alerts: InboxAlert[];
  onDismiss: (id: string) => void;
  onSend: (id: string) => void;
  canSend: boolean;
  highlightAlertId: string | null;
  onHighlightConsumed: () => void;
}) {
  const { alerts, onDismiss, onSend, canSend, highlightAlertId, onHighlightConsumed } = props;
  // When the page lands with #alert=<id> in the URL, scroll that alert
  // into view, briefly highlight it, and clear the hash so a refresh
  // doesn't re-trigger.
  useEffect(() => {
    if (!highlightAlertId) return;
    const target = alerts.find((a) => a.id === highlightAlertId);
    if (!target) return;
    const el = document.querySelector(`[data-testid="alert-${highlightAlertId}"]`);
    if (el && "scrollIntoView" in el) {
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      const details = el.querySelector("details");
      if (details) details.setAttribute("open", "true");
    }
    const t = setTimeout(() => {
      onHighlightConsumed();
      if (window.location.hash) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [highlightAlertId, alerts, onHighlightConsumed]);
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-6 sm:p-8 mb-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-fg-muted mb-4">
        <ShieldAlert className="h-3.5 w-3.5" />
        <span>Recent alerts</span>
      </div>
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {alerts.map((a) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-lg border bg-bg p-4 transition-colors ${
                highlightAlertId === a.id
                  ? "border-accent shadow-[0_0_0_2px_rgb(var(--accent)/0.35)]"
                  : "border-border"
              }`}
              data-testid={`alert-${a.id}`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="text-xs font-mono uppercase tracking-widest text-accent">
                    {a.category.replace("_", " ")}
                  </div>
                  <div className="font-display text-base mt-0.5">{a.subject}</div>
                  <div className="text-xs text-fg-muted">{a.senderDisplay}</div>
                </div>
                <span className="text-[10px] font-mono uppercase text-fg-muted">
                  {a.status}
                </span>
              </div>
              <p className="text-sm text-fg mb-2">{a.gist}</p>
              {a.deadlineIso && (
                <div className="text-xs text-amber-200 mb-2">
                  Deadline: {a.deadlineIso}
                </div>
              )}
              {a.draftedReply && (
                <details className="text-sm bg-bg-elevated rounded p-3 mb-3 border border-border">
                  <summary className="cursor-pointer text-xs text-fg-muted uppercase tracking-widest">
                    Drafted reply
                  </summary>
                  <pre className="whitespace-pre-wrap font-sans text-fg mt-2">
                    {a.draftedReply}
                  </pre>
                </details>
              )}
              {a.callSid && (
                <div className="text-xs text-fg-muted inline-flex items-center gap-1 mb-2">
                  <PhoneCall className="h-3 w-3" /> Outbound call placed:{" "}
                  <span className="font-mono">{a.callSid}</span>
                </div>
              )}
              {(a.status === "fired" || a.status === "dispatched") && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSend(a.id)}
                    disabled={!canSend || !a.draftedReply}
                    className="px-3 py-1.5 rounded-base bg-accent text-accent-fg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                    data-testid={`button-send-${a.id}`}
                    title={canSend ? "" : "Connect Gmail to enable sending"}
                  >
                    <Send className="h-3 w-3" /> Send reply
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(a.id)}
                    className="ghost-btn px-3 py-1.5 rounded-base text-xs inline-flex items-center gap-1.5"
                    data-testid={`button-dismiss-${a.id}`}
                  >
                    <X className="h-3 w-3" /> Dismiss
                  </button>
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function DisclaimerStrip() {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated/50 p-4 text-xs text-fg-muted">
      <strong className="text-fg">Privacy.</strong> Email content is processed
      in memory by the classifier. Only the verdict, the plain-language gist,
      and the drafted reply you explicitly review are persisted. The original
      message body is never written to {BRAND.name}&apos;s database.
    </div>
  );
}
