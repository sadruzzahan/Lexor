import type { Extraction } from "../vision";
import type { Violation } from "./index";
import { getStatute } from "../grounding/statutes";

export function detectWageViolations(
  ext: Extraction,
  jurisdiction: string | null,
): Violation[] {
  const out: Violation[] = [];
  const t = ext.rawText;

  // Final paycheck timing — CA requires immediate
  if (jurisdiction === "US-CA" && /terminat|let go|laid off|fired/i.test(t)) {
    const promisesLater = /your final (check|paycheck) will be (mailed|sent|issued) (in|within|on)/i.test(
      t,
    );
    const noImmediate = !/today|immediately|on your last day/i.test(t);
    if (promisesLater || noImmediate) {
      const s = getStatute("Cal. Lab. Code § 201")!;
      out.push({
        code: "CA_LAB_201_LATE_FINAL_PAY",
        statute: s.code,
        description:
          "California requires final wages to be paid immediately on termination. Late final pay accrues 'waiting time' penalties of one day's wages per day, up to 30 days.",
        severity: "high",
        citationUrl: s.url,
        agency: "DOL_WHD",
      });
    }
  }

  // Misclassification flags — language suggesting off-the-books overtime
  if (
    /independent contractor/i.test(t) &&
    /(set hours|report to|supervisor|company equipment|exclusive)/i.test(t)
  ) {
    const s = getStatute("29 U.S.C. § 207")!;
    out.push({
      code: "FLSA_MISCLASSIFICATION",
      statute: s.code,
      description:
        "The letter labels you an 'independent contractor' but describes employment-style controls (set hours, supervisor, company equipment). Misclassification denies you minimum wage and overtime protections.",
      severity: "high",
      citationUrl: s.url,
      agency: "DOL_WHD",
    });
  }

  // OT denial — explicit "no overtime" / "salaried so no OT"
  if (/(salaried.*no overtime|not entitled to overtime|exempt from overtime)/i.test(t)) {
    const s = getStatute("29 U.S.C. § 207")!;
    out.push({
      code: "FLSA_OT_DENIAL",
      statute: s.code,
      description:
        "Salary alone does not exempt an employee from overtime. The FLSA requires 1.5× pay for hours over 40 unless a specific exemption applies (and the burden is on the employer).",
      severity: "high",
      citationUrl: s.url,
      agency: "DOL_WHD",
    });
  }

  // Sub-minimum wage references
  const hourlyMatch = t.match(/\$(\d+\.\d{1,2})\s*(?:per|\/)\s*hour/i);
  if (hourlyMatch && parseFloat(hourlyMatch[1]!) < 7.25) {
    const s = getStatute("29 U.S.C. § 206")!;
    out.push({
      code: "FLSA_SUBMINIMUM_WAGE",
      statute: s.code,
      description: `The letter references an hourly rate of $${hourlyMatch[1]}, below the federal minimum wage of $7.25. Many states require even higher minimums.`,
      severity: "critical",
      citationUrl: s.url,
      agency: "DOL_WHD",
    });
  }

  return out;
}
