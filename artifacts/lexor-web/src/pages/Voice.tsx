import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PhoneCall, MessageCircle, Languages, ShieldAlert } from "lucide-react";
import { useDocumentTitle } from "@/lib/hooks";
import { getVoiceInfo, type VoiceInfo } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export default function VoicePage() {
  useDocumentTitle(`Voice & WhatsApp · ${BRAND.name}`);
  const [info, setInfo] = useState<VoiceInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState<string>("en");

  useEffect(() => {
    getVoiceInfo()
      .then(setInfo)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const phone = info?.phoneNumber ?? BRAND.phone;
  const wa = info?.whatsappNumber ?? null;
  const langs = info?.languages ?? [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
  ];
  const disclaimer = info?.spokenDisclaimer?.[activeLang] ?? "";

  return (
    <section className="mx-auto max-w-5xl px-4 sm:px-6 py-12 sm:py-20">
      <header className="text-center mb-12">
        <h1 className="font-display text-4xl sm:text-6xl tracking-tight">
          Speak any language. <span className="text-accent">No screen needed.</span>
        </h1>
        <p className="mt-4 text-lg text-fg-muted max-w-2xl mx-auto">
          {BRAND.name} works by phone and on WhatsApp — for anyone with a $40 phone
          and no time for paperwork. Free, real-time, in six languages.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-border bg-bg-elevated p-8"
        >
          <div className="flex items-center gap-3 text-accent mb-4">
            <PhoneCall className="w-5 h-5" />
            <span className="text-xs uppercase tracking-widest">Call</span>
          </div>
          <div className="font-display text-3xl tracking-tight">{phone}</div>
          <p className="mt-3 text-sm text-fg-muted">
            Dial and you're talking to {BRAND.name} in under three seconds. Reads
            the legal disclaimer in your language, helps you describe the letter,
            and texts you a link to upload a photo if you need.
          </p>
          {!info?.configured && (
            <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
              Voice is in setup — phone routing not yet provisioned. Bridge code is
              live; will work the moment Twilio + OpenAI keys are added.
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-2xl border border-border bg-bg-elevated p-8"
        >
          <div className="flex items-center gap-3 text-accent mb-4">
            <MessageCircle className="w-5 h-5" />
            <span className="text-xs uppercase tracking-widest">WhatsApp</span>
          </div>
          <div className="flex items-start gap-6">
            <div className="rounded-xl border border-border bg-bg overflow-hidden">
              <img
                src="/api/counsel/whatsapp/qrcode"
                alt="Scan to join Lexor on WhatsApp"
                width={160}
                height={160}
                className="block"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="text-sm text-fg-muted leading-relaxed">
              Scan with your phone, then send a photo of the letter, paste text,
              or hold to record a voice note in your language. We reply with a
              one-line explainer + a link to your full case in under 60&nbsp;seconds.
              {wa && (
                <div className="mt-3 font-mono text-xs text-fg-subtle">
                  Number: {wa}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-bg-elevated p-8">
        <div className="flex items-center gap-3 text-accent mb-4">
          <Languages className="w-5 h-5" />
          <span className="text-xs uppercase tracking-widest">Languages</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {langs.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setActiveLang(l.code)}
              className={`px-3 py-1.5 rounded-full border text-sm transition ${
                activeLang === l.code
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        {disclaimer && (
          <div className="mt-6 rounded-xl border border-border-subtle bg-bg p-5 text-sm text-fg-muted leading-relaxed">
            <div className="text-xs uppercase tracking-widest text-fg-subtle mb-2 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              Spoken disclaimer ({activeLang})
            </div>
            <p>{disclaimer}</p>
          </div>
        )}
      </div>

      {err && (
        <p className="mt-6 text-xs text-violation text-center">
          Couldn't load live numbers: {err}
        </p>
      )}
    </section>
  );
}
