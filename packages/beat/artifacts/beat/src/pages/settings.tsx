import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Shield, Globe, Server, ExternalLink, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useListCases, getListCasesQueryKey } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { useCurrentUser } from "@/contexts/AuthContext";
import type { Case } from "@workspace/api-client-react";

const SUB_PROCESSORS = [
  {
    name: "Anthropic",
    desc: "LLM inference for investigation agents (Claude)",
    url: "https://www.anthropic.com/privacy",
  },
  {
    name: "Google Gemini",
    desc: "Vision AI for scene photo auto-tagging",
    url: "https://policies.google.com/privacy",
  },
  {
    name: "OpenAI",
    desc: "Audio transcription (Whisper) for witness statements",
    url: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "E2B",
    desc: "Sandboxed code execution for transcription fallback",
    url: "https://e2b.dev/privacy",
  },
  {
    name: "Tavily",
    desc: "Real-time web search for suspect background checks",
    url: "https://tavily.com/privacy",
  },
  {
    name: "Replit PostgreSQL",
    desc: "Primary case data storage (investigation records, files)",
    url: "https://replit.com/privacy",
  },
];

/** Map ISO 3166-1 alpha-2 country code → jurisdiction compliance note */
const COMPLIANCE_MAP: Record<
  string,
  { title: string; note: string }
> = {
  US: {
    title: "CJIS Security Policy (US)",
    note: "Criminal Justice Information Services (CJIS) Security Policy applies when handling criminal justice data. AI-generated output is not validated for CJIS compliance and must not be submitted to NCIC or CJIS systems. All data must be independently verified before use in any official law enforcement context.",
  },
  GB: {
    title: "PACE / CPIA (England & Wales)",
    note: "PACE (Police and Criminal Evidence Act 1984) and CPIA (Criminal Procedure and Investigations Act 1996) govern the admissibility of evidence. AI-generated analysis is not admissible as evidence. Investigators must obtain corroborating material through lawful means. UK GDPR applies to all personal data processed.",
  },
  IE: {
    title: "GDPR / Law Enforcement Directive (EU)",
    note: "General Data Protection Regulation (GDPR) and the EU Law Enforcement Directive (LED) apply. AI-generated output may not be used as the sole basis for decisions affecting individuals (Art. 22 GDPR). Automated profiling requires human oversight and must comply with LED Art. 11.",
  },
  IN: {
    title: "BNSS 2023 / DPDPA 2023 (India)",
    note: "The Bharatiya Nagarik Suraksha Sanhita (BNSS) 2023 and the Digital Personal Data Protection Act (DPDPA) 2023 apply. AI-assisted analysis must be corroborated by lawful evidence under BNSS. Biometric and sensitive personal data processing requires explicit consent under DPDPA. This tool is not certified for use in any Indian court proceedings.",
  },
};

/** EU member country codes that fall under GDPR */
const EU_CODES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
  "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);

/** UK is an alias for GB — same PACE/CPIA framework */
const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
};

const FALLBACK_COMPLIANCE = {
  title: "General Data Protection Notice",
  note: "This tool generates AI-assisted analysis for investigative research purposes only. Output must not be used as evidence in any legal, judicial, or administrative proceeding without independent verification and applicable legal authority. Ensure compliance with your local jurisdiction's laws governing criminal investigations and data protection.",
};

interface JurisdictionContext {
  country?: string;
  region?: string;
  language?: string;
  legalSystem?: string;
  confidence?: number;
  statutes?: string[];
}

function getComplianceInfo(
  country: string,
  legalSystem?: string,
): { title: string; note: string } {
  const raw = country.toUpperCase();
  const code = COUNTRY_ALIASES[raw] ?? raw;

  if (legalSystem) {
    const compound = `${code}:${legalSystem.toLowerCase().replace(/\s+/g, "_")}`;
    if (COMPLIANCE_MAP[compound]) return COMPLIANCE_MAP[compound];
  }

  if (COMPLIANCE_MAP[code]) return COMPLIANCE_MAP[code];

  if (EU_CODES.has(code)) return COMPLIANCE_MAP["IE"];

  return FALLBACK_COMPLIANCE;
}

function getMostRecentJurisdiction(cases: Case[]): JurisdictionContext | null {
  const sorted = [...cases]
    .filter((c) => c.jurisdictionContext != null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (!sorted.length) return null;
  return sorted[0].jurisdictionContext as JurisdictionContext;
}

export default function Settings() {
  const [browserCountry, setBrowserCountry] = useState<string>("");
  const [locale, setLocale] = useState<string>("");
  const { user, isLoading: authLoading } = useCurrentUser();
  const { signOut } = useClerk();

  const { data: casesData, isLoading: casesLoading } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });

  useEffect(() => {
    const lang = navigator.language || "en-US";
    setLocale(lang);
    const parts = lang.split("-");
    setBrowserCountry(parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "");
  }, []);

  const { jurisdictionCtx, countryCode } = useMemo(() => {
    const cases = casesData?.cases ?? [];
    const jc = getMostRecentJurisdiction(cases);
    const country = jc?.country?.toUpperCase() ?? browserCountry;
    return { jurisdictionCtx: jc, countryCode: country };
  }, [casesData, browserCountry]);

  const compliance = countryCode
    ? getComplianceInfo(countryCode, jurisdictionCtx?.legalSystem)
    : null;

  const jurisdictionLabel = jurisdictionCtx
    ? `${jurisdictionCtx.country}${jurisdictionCtx.region ? ` · ${jurisdictionCtx.region}` : ""} (AI-detected)`
    : browserCountry
    ? `${browserCountry} · ${locale} (browser locale)`
    : null;

  const displayName = user?.displayName ?? "Detective";
  const displayId = user?.id ?? "—";
  const tier = user?.tier ?? "free";

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="settings-screen">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border px-4 py-3">
        <h1 className="text-base font-bold tracking-tight text-foreground">Profile & Data</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* User card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-border bg-card p-5 flex items-center gap-4"
        >
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)" }}
            aria-hidden="true"
          >
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            {authLoading ? (
              <>
                <Skeleton className="h-4 w-32 mb-1" />
                <Skeleton className="h-3 w-48 mt-0.5" />
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-foreground">{displayName}</p>
                {user?.email && (
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                )}
                <p className="text-[10px] text-muted-foreground font-mono truncate opacity-60">{displayId}</p>
              </>
            )}
            <div className="mt-1.5">
              <Badge
                variant="outline"
                className="text-[10px] font-mono border-yellow-400/40 text-yellow-400 bg-yellow-400/10"
                data-testid="badge-tier"
              >
                {tier === "agency" ? "Agency tier" : "Free tier"}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => void signOut()}
            data-testid="button-sign-out"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-xs">Sign out</span>
          </Button>
        </motion.div>

        {/* Evidentiary warning */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 p-4 flex items-start gap-3"
          role="alert"
          data-testid="banner-not-evidentiary"
        >
          <Globe className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-yellow-400">Not for evidentiary use</p>
            <p className="text-[11px] text-muted-foreground">
              AI-generated analysis must not be used as evidence in any legal proceeding without independent verification.
            </p>
          </div>
        </motion.div>

        {/* Jurisdiction compliance note */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-lg border border-border bg-card p-4 space-y-3"
          data-testid="jurisdiction-banner"
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">Detected Jurisdiction</p>
              {casesLoading ? (
                <Skeleton className="h-3 w-32 mt-0.5" />
              ) : (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {jurisdictionLabel ?? "Not yet detected — run an investigation first"}
                </p>
              )}
            </div>
          </div>
          {compliance && (
            <>
              <p
                className="text-[10px] font-mono font-semibold text-primary/80 uppercase tracking-wider"
                data-testid="jurisdiction-framework"
              >
                {compliance.title}
              </p>
              <p
                className="text-[11px] text-muted-foreground leading-relaxed"
                data-testid="jurisdiction-compliance-note"
              >
                {compliance.note}
              </p>
            </>
          )}
          {!compliance && !casesLoading && (
            <p
              className="text-[11px] text-muted-foreground leading-relaxed"
              data-testid="jurisdiction-compliance-note"
            >
              {FALLBACK_COMPLIANCE.note}
            </p>
          )}
        </motion.div>

        {/* Sub-processors */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-lg border border-border bg-card overflow-hidden"
          data-testid="sub-processors-section"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Server className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs font-bold text-foreground tracking-tight">Data & AI Sub-processors</p>
          </div>
          <div className="divide-y divide-border/50">
            {SUB_PROCESSORS.map((sp, i) => (
              <div
                key={sp.name}
                className="flex items-center justify-between px-4 py-3"
                data-testid={`sub-processor-${i}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{sp.name}</p>
                  <p className="text-[11px] text-muted-foreground">{sp.desc}</p>
                </div>
                <a
                  href={sp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={`${sp.name} privacy policy`}
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </motion.div>

        {jurisdictionCtx?.statutes && jurisdictionCtx.statutes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="rounded-lg border border-border bg-card p-4"
            data-testid="detected-statutes"
          >
            <p className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Detected Applicable Statutes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {jurisdictionCtx.statutes.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-mono px-2 py-0.5 rounded border"
                  style={{ borderColor: "rgba(0,255,136,0.2)", background: "rgba(0,255,136,0.05)", color: "#8FA89A" }}
                >
                  {s}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        <p className="text-center text-[10px] text-muted-foreground font-mono">
          Beat Detective Field Kit · v0.1.0
        </p>
      </div>
    </div>
  );
}
