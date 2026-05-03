import type { Extraction } from "./vision";

export type Vertical = "eviction" | "debt" | "wage" | "other";

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
    other: 0,
  };
  for (const v of ["eviction", "debt", "wage"] as const) {
    for (const re of KEYWORDS[v]) {
      if (re.test(haystack)) scores[v] += 1;
    }
  }
  const winner = (Object.entries(scores) as [Vertical, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return winner && winner[1] >= 2 ? winner[0] : "other";
}

const STATE_REGEX =
  /\b(?:Alabama|AL|Alaska|AK|Arizona|AZ|Arkansas|AR|California|CA|Colorado|CO|Connecticut|CT|Delaware|DE|Florida|FL|Georgia|GA|Hawaii|HI|Idaho|ID|Illinois|IL|Indiana|IN|Iowa|IA|Kansas|KS|Kentucky|KY|Louisiana|LA|Maine|ME|Maryland|MD|Massachusetts|MA|Michigan|MI|Minnesota|MN|Mississippi|MS|Missouri|MO|Montana|MT|Nebraska|NE|Nevada|NV|New Hampshire|NH|New Jersey|NJ|New Mexico|NM|New York|NY|North Carolina|NC|North Dakota|ND|Ohio|OH|Oklahoma|OK|Oregon|OR|Pennsylvania|PA|Rhode Island|RI|South Carolina|SC|South Dakota|SD|Tennessee|TN|Texas|TX|Utah|UT|Vermont|VT|Virginia|VA|Washington|WA|West Virginia|WV|Wisconsin|WI|Wyoming|WY)\b/i;

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
    extraction.rawText.slice(0, 800),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const m = c.match(STATE_REGEX);
    if (m) return STATE_TO_ISO[m[0].toLowerCase()] ?? null;
  }
  return null;
}
