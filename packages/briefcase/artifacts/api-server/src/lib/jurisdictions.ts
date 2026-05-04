/**
 * Curated trusted-source map for jurisdiction-biased Tavily search.
 * Locked top-15 list from BRIEFCASE spec §10.2. Used by PrecedentFinder
 * (and any future RightsAuditor / BradyDetector subagents).
 *
 * Outside this list the agent does an unbiased search and the citation
 * verifier still enforces honesty.
 */
export interface JurisdictionEntry {
  country: string;
  iso2: string;
  legalSystem: "common_law" | "civil_law" | "mixed";
  primaryLanguages: string[];
  trustedDomains: string[];
}

export const JURISDICTIONS: Record<string, JurisdictionEntry> = {
  US: {
    country: "United States",
    iso2: "US",
    legalSystem: "common_law",
    primaryLanguages: ["en"],
    trustedDomains: [
      "courtlistener.com",
      "law.cornell.edu",
      "supreme.justia.com",
      "govinfo.gov",
    ],
  },
  GB: {
    country: "United Kingdom",
    iso2: "GB",
    legalSystem: "common_law",
    primaryLanguages: ["en"],
    trustedDomains: [
      "bailii.org",
      "legislation.gov.uk",
      "judiciary.uk",
      "caselaw.nationalarchives.gov.uk",
    ],
  },
  CA: {
    country: "Canada",
    iso2: "CA",
    legalSystem: "common_law",
    primaryLanguages: ["en", "fr"],
    trustedDomains: [
      "canlii.org",
      "scc-csc.ca",
      "laws-lois.justice.gc.ca",
    ],
  },
  AU: {
    country: "Australia",
    iso2: "AU",
    legalSystem: "common_law",
    primaryLanguages: ["en"],
    trustedDomains: ["austlii.edu.au", "hcourt.gov.au", "legislation.gov.au"],
  },
  IN: {
    country: "India",
    iso2: "IN",
    legalSystem: "common_law",
    primaryLanguages: ["en", "hi"],
    trustedDomains: ["indiankanoon.org", "sci.gov.in", "legislative.gov.in"],
  },
  DE: {
    country: "Germany",
    iso2: "DE",
    legalSystem: "civil_law",
    primaryLanguages: ["de"],
    trustedDomains: [
      "gesetze-im-internet.de",
      "dejure.org",
      "bverfg.de",
      "juris.de",
    ],
  },
  FR: {
    country: "France",
    iso2: "FR",
    legalSystem: "civil_law",
    primaryLanguages: ["fr"],
    trustedDomains: ["legifrance.gouv.fr", "courdecassation.fr", "conseil-etat.fr"],
  },
  BR: {
    country: "Brazil",
    iso2: "BR",
    legalSystem: "civil_law",
    primaryLanguages: ["pt"],
    trustedDomains: ["jusbrasil.com.br", "stf.jus.br", "planalto.gov.br"],
  },
  ES: {
    country: "Spain",
    iso2: "ES",
    legalSystem: "civil_law",
    primaryLanguages: ["es"],
    trustedDomains: ["boe.es", "poderjudicial.es", "tribunalconstitucional.es"],
  },
  IT: {
    country: "Italy",
    iso2: "IT",
    legalSystem: "civil_law",
    primaryLanguages: ["it"],
    trustedDomains: [
      "normattiva.it",
      "cortecostituzionale.it",
      "cortedicassazione.it",
    ],
  },
  MX: {
    country: "Mexico",
    iso2: "MX",
    legalSystem: "civil_law",
    primaryLanguages: ["es"],
    trustedDomains: ["scjn.gob.mx", "dof.gob.mx", "diputados.gob.mx"],
  },
  JP: {
    country: "Japan",
    iso2: "JP",
    legalSystem: "civil_law",
    primaryLanguages: ["ja"],
    trustedDomains: ["courts.go.jp", "e-gov.go.jp", "kantei.go.jp"],
  },
  ZA: {
    country: "South Africa",
    iso2: "ZA",
    legalSystem: "mixed",
    primaryLanguages: ["en", "af"],
    trustedDomains: ["saflii.org", "justice.gov.za", "concourt.org.za"],
  },
  NL: {
    country: "Netherlands",
    iso2: "NL",
    legalSystem: "civil_law",
    primaryLanguages: ["nl"],
    trustedDomains: ["rechtspraak.nl", "wetten.overheid.nl"],
  },
  IE: {
    country: "Ireland",
    iso2: "IE",
    legalSystem: "common_law",
    primaryLanguages: ["en"],
    trustedDomains: ["bailii.org", "courts.ie", "irishstatutebook.ie"],
  },
};

export function trustedDomainsFor(iso2?: string | null): string[] {
  if (!iso2) return [];
  const entry = JURISDICTIONS[iso2.toUpperCase()];
  return entry ? [...entry.trustedDomains] : [];
}

export interface JurisdictionContext {
  country: string;
  iso2: string;
  region?: string;
  legalSystem: "common_law" | "civil_law" | "mixed" | "unknown";
  language: string;
  confidence: number;
}
