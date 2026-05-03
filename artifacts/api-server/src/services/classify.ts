import type { Extraction } from "./vision";

export type Vertical = "eviction" | "debt" | "wage" | "contract" | "other";

const KEYWORDS: Record<Exclude<Vertical, "other">, RegExp[]> = {
  eviction: [
    /notice to (quit|vacate|cure)/i,
    /unlawful detainer/i,
    /eviction/i,
    /landlord/i,
    /lease/i,
    /tenancy/i,
    /three[\s-]day notice/i,
    /pay or quit/i,
    /AB[\s-]?1482/i,
    /just cause/i,
  ],
  debt: [
    /debt collect/i,
    /balance due/i,
    /validation of debt/i,
    /FDCPA/i,
    /collection agency/i,
    /charged off/i,
    /past due account/i,
    /this is an attempt to collect/i,
  ],
  wage: [
    /termination/i,
    /final paycheck/i,
    /wage/i,
    /overtime/i,
    /minimum wage/i,
    /FLSA/i,
    /independent contractor/i,
    /misclassif/i,
    /payroll/i,
    /your last day/i,
  ],
  contract: [
    /breach of (contract|agreement|MSA|NDA|SLA)/i,
    /master service agreement/i,
    /\bMSA\b/,
    /legal demand/i,
    /demand (notice|letter)/i,
    /tortious interference/i,
    /unjust enrichment/i,
    /misappropriat/i,
    /intellectual property/i,
    /source code/i,
    /liquidated damages/i,
    /indemnif/i,
    /obfuscat/i,
    /fraud(ulent)?/i,
    /specific performance/i,
    /injunctive relief/i,
    /arbitration clause/i,
    /scope of work/i,
    /deliverable/i,
    /compound interest/i,
    /legal fees and court costs/i,
    /advocate|barrister|solicitor/i,
  ],
};

export function classify(extraction: Extraction): Vertical {
  const haystack = [
    extraction.documentType,
    extraction.rawText,
    ...extraction.keyClaims,
    extraction.sender.role ?? "",
  ]
    .join("\n")
    .toLowerCase();

  const scores: Record<Vertical, number> = {
    eviction: 0,
    debt: 0,
    wage: 0,
    contract: 0,
    other: 0,
  };
  for (const v of ["eviction", "debt", "wage", "contract"] as const) {
    for (const re of KEYWORDS[v]) {
      if (re.test(haystack)) scores[v] += 1;
    }
  }
  const winner = (Object.entries(scores) as [Vertical, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return winner && winner[1] >= 2 ? winner[0] : "other";
}

// Full state names — safe to match anywhere (case-insensitive, word-bounded).
const STATE_NAME_REGEX =
  /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;

// 2-letter state codes are ambiguous in prose ("IN", "OR", "ME", "OH").
// Only trust them when they appear in an address-shaped context — i.e.
// preceded by a comma + space and followed by a US ZIP (5 digits, optional +4).
// Examples that match: "Los Angeles, CA 90013", "Brooklyn, NY 11201-1234".
// Examples that do NOT match: "in this case", "or perhaps", "Maine doctrine".
const STATE_ADDR_REGEX =
  /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;

const STATE_TO_ISO: Record<string, string> = {
  alabama: "US-AL", al: "US-AL",
  alaska: "US-AK", ak: "US-AK",
  arizona: "US-AZ", az: "US-AZ",
  arkansas: "US-AR", ar: "US-AR",
  california: "US-CA", ca: "US-CA",
  colorado: "US-CO", co: "US-CO",
  connecticut: "US-CT", ct: "US-CT",
  delaware: "US-DE", de: "US-DE",
  florida: "US-FL", fl: "US-FL",
  georgia: "US-GA", ga: "US-GA",
  hawaii: "US-HI", hi: "US-HI",
  idaho: "US-ID", id: "US-ID",
  illinois: "US-IL", il: "US-IL",
  indiana: "US-IN", in: "US-IN",
  iowa: "US-IA", ia: "US-IA",
  kansas: "US-KS", ks: "US-KS",
  kentucky: "US-KY", ky: "US-KY",
  louisiana: "US-LA", la: "US-LA",
  maine: "US-ME", me: "US-ME",
  maryland: "US-MD", md: "US-MD",
  massachusetts: "US-MA", ma: "US-MA",
  michigan: "US-MI", mi: "US-MI",
  minnesota: "US-MN", mn: "US-MN",
  mississippi: "US-MS", ms: "US-MS",
  missouri: "US-MO", mo: "US-MO",
  montana: "US-MT", mt: "US-MT",
  nebraska: "US-NE", ne: "US-NE",
  nevada: "US-NV", nv: "US-NV",
  "new hampshire": "US-NH", nh: "US-NH",
  "new jersey": "US-NJ", nj: "US-NJ",
  "new mexico": "US-NM", nm: "US-NM",
  "new york": "US-NY", ny: "US-NY",
  "north carolina": "US-NC", nc: "US-NC",
  "north dakota": "US-ND", nd: "US-ND",
  ohio: "US-OH", oh: "US-OH",
  oklahoma: "US-OK", ok: "US-OK",
  oregon: "US-OR", or: "US-OR",
  pennsylvania: "US-PA", pa: "US-PA",
  "rhode island": "US-RI", ri: "US-RI",
  "south carolina": "US-SC", sc: "US-SC",
  "south dakota": "US-SD", sd: "US-SD",
  tennessee: "US-TN", tn: "US-TN",
  texas: "US-TX", tx: "US-TX",
  utah: "US-UT", ut: "US-UT",
  vermont: "US-VT", vt: "US-VT",
  virginia: "US-VA", va: "US-VA",
  washington: "US-WA", wa: "US-WA",
  "west virginia": "US-WV", wv: "US-WV",
  wisconsin: "US-WI", wi: "US-WI",
  wyoming: "US-WY", wy: "US-WY",
};

export function inferJurisdiction(extraction: Extraction): string | null {
  const candidates = [
    extraction.sender.address,
    extraction.recipient.address,
    extraction.rawText.slice(0, 1500),
  ].filter((c): c is string => Boolean(c));

  // Pass 1: address-shaped 2-letter code (",  CA 90210").
  for (const c of candidates) {
    const m = c.match(STATE_ADDR_REGEX);
    if (m && m[1]) {
      const iso = STATE_TO_ISO[m[1].toLowerCase()];
      if (iso) return iso;
    }
  }

  // Pass 2: full state name anywhere (unambiguous — "California", "New York").
  for (const c of candidates) {
    const m = c.match(STATE_NAME_REGEX);
    if (m) {
      const iso = STATE_TO_ISO[m[0].toLowerCase()];
      if (iso) return iso;
    }
  }

  return null;
}
