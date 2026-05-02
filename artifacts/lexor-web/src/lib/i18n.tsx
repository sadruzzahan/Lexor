import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BRAND } from "./brand";

export type Locale = "en" | "es";

const en = {
  "nav.home": "Home",
  "nav.upload": "Upload",
  "nav.map": "Map",
  "nav.voice": "Voice",
  "nav.account": "Account",
  "nav.coalitions": "Coalitions",
  "nav.disclaimers": "Disclaimers",
  "nav.about": "About",
  "nav.privacy": "Privacy",
  "header.attorney": "Talk to a licensed attorney",
  "header.cmd": "Press ⌘K",
  "header.lang": "Language",
  "header.cmdk.aria": "Open command palette",
  "header.parent": `by ${BRAND.parent}`,
  "hero.live": "live",
  "modal.version": `${BRAND.name.toLowerCase()} · v1`,
  "nav.mobile.aria": "Primary mobile",
  "brand.tagline": "Drop in any scary letter. Get your power back in 30 seconds.",
  "brand.subtagline": `${BRAND.name} is your free legal-help assistant for evictions, debt, and wage theft. Speak any language. No account needed.`,
  "brand.footer": `${BRAND.name} is not a law firm. AI-generated information — not legal advice. © ${BRAND.name}.`,
  "hero.cta.primary": "Upload a letter",
  "hero.cta.secondary": "Or call",
  "section.bento.heading": "Built for the people the system overcharges.",
  "bento.1.title": "Letter → Defense in 30s",
  "bento.1.desc": "Drop a photo. Get plain-language meaning, the laws on your side, and a response ready to send.",
  "bento.2.title": "Adversary X-ray",
  "bento.2.desc": "See the other side's full litigation history before you reply.",
  "bento.3.title": "Predator Map",
  "bento.3.desc": "A live map of bad actors pinned by every verified violation.",
  "bento.4.title": "Coalitions",
  "bento.4.desc": "Find everyone in your zip code fighting the same opponent.",
  "bento.5.title": "Voice & WhatsApp",
  "bento.5.desc": "Call or message. We work even if you can't read or type.",
  "bento.6.title": "Rights library (EN/ES)",
  "bento.6.desc": "Plain-language rights guides, cited to statute, in your language.",
  "bento.7.title": "Counter-attack filings",
  "bento.7.desc": "Pre-filled regulator complaints for every violation we detect.",
  "bento.8.title": "Grounded citations",
  "bento.8.desc": "Every law we cite is fetched from a real source at request time.",
  "footer.disclaimer.link": "Disclaimer",
  "footer.about.link": "About",
  "footer.privacy.link": "Privacy",
  "modal.title": "Before you continue",
  "modal.body.lead": `${BRAND.name} is an AI-powered self-help tool, not a law firm.`,
  "modal.body.p1.head": "No attorney-client relationship.",
  "modal.body.p1.text": `Using ${BRAND.name} does not create an attorney-client relationship with anyone.`,
  "modal.body.p2.head": "No confidentiality.",
  "modal.body.p2.text": `Anything you share with ${BRAND.name} is not protected by attorney-client privilege.`,
  "modal.body.p3.head": "Not a substitute for an attorney.",
  "modal.body.p3.text": `${BRAND.name} provides legal information and document drafts, not legal advice. For decisions that affect your rights, consult a licensed attorney in your jurisdiction.`,
  "modal.body.tail": "By continuing, you confirm you understand the above.",
  "modal.cta": "I understand and agree",
  "page.upload.title": "Upload",
  "page.case.title": "Case",
  "page.map.title": "Predator Map",
  "page.coalition.title": "Coalition",
  "page.entity.title": "Entity profile",
  "page.voice.title": "Voice & WhatsApp",
  "page.rights.title": "Your rights",
  "page.about.title": `About ${BRAND.name}`,
  "page.disclaimer.title": "Legal disclaimer",
  "soon": "Coming online soon.",
  "soon.note": "This surface is part of the Lexor build. The shell, design system, and protections are live; the workflow lights up next.",
  "cmdk.placeholder": "Type a command or search…",
  "cmdk.label": `${BRAND.name} commands`,
  "cmdk.empty": "No results.",
  "cmdk.close": "Close",
  "cmdk.aria": "Command palette",
  "cmdk.group.go": "Go",
  "cmdk.group.actions": "Actions",
  "cmdk.lang": "Switch language",
  "cmdk.call": `Call ${BRAND.name}`,
  "cmdk.disclaimers": "Read disclaimers",
  "cmdk.entity": "Find an entity",
  "cmdk.new": "New case",
  "about.lead": "Lexor collapses the legal system's information asymmetry — the asymmetry that lets landlords, employers, and debt collectors prey on people who don't have $400/hr lawyers.",
  "about.body": "Every upload makes the network stronger for the next person.",
  "attorney.section.title": "Find a licensed attorney",
  "attorney.section.body": `${BRAND.name} is information, not legal advice. For decisions that affect your rights, consult a licensed attorney in your jurisdiction. Local bar association referral lines and legal-aid directories are the fastest path.`,
  "notfound.title": "Page not found",
  "notfound.body": "That page is not part of the build yet — check the menu or the command palette.",
  "notfound.cta": "Back to home",
} as const;

export type TKey = keyof typeof en;
type Dict = Record<TKey, string>;

const es: Dict = {
  "nav.home": "Inicio",
  "nav.upload": "Subir",
  "nav.map": "Mapa",
  "nav.voice": "Voz",
  "nav.account": "Cuenta",
  "nav.coalitions": "Coaliciones",
  "nav.disclaimers": "Avisos",
  "nav.about": "Acerca",
  "nav.privacy": "Privacidad",
  "header.attorney": "Habla con un abogado licenciado",
  "header.cmd": "Pulsa ⌘K",
  "header.lang": "Idioma",
  "header.cmdk.aria": "Abrir paleta de comandos",
  "header.parent": `por ${BRAND.parent}`,
  "hero.live": "en vivo",
  "modal.version": `${BRAND.name.toLowerCase()} · v1`,
  "nav.mobile.aria": "Navegación móvil",
  "brand.tagline": "Sube cualquier carta intimidante. Recupera tu poder en 30 segundos.",
  "brand.subtagline": `${BRAND.name} es tu asistente legal gratuito para desalojos, deudas y robo de salario. Habla cualquier idioma. Sin cuenta.`,
  "brand.footer": `${BRAND.name} no es un despacho de abogados. Información generada por IA — no es asesoramiento legal. © ${BRAND.name}.`,
  "hero.cta.primary": "Subir una carta",
  "hero.cta.secondary": "O llama al",
  "section.bento.heading": "Hecho para las personas a quienes el sistema cobra de más.",
  "bento.1.title": "Carta → Defensa en 30s",
  "bento.1.desc": "Sube una foto. Recibe el significado claro, las leyes a tu favor y una respuesta lista para enviar.",
  "bento.2.title": "Radiografía del adversario",
  "bento.2.desc": "Conoce todo el historial litigioso del otro lado antes de responder.",
  "bento.3.title": "Mapa de depredadores",
  "bento.3.desc": "Mapa en vivo de malos actores marcados por cada violación verificada.",
  "bento.4.title": "Coaliciones",
  "bento.4.desc": "Encuentra a quienes en tu código postal pelean contra el mismo oponente.",
  "bento.5.title": "Voz y WhatsApp",
  "bento.5.desc": "Llama o escribe. Funciona aunque no puedas leer o escribir.",
  "bento.6.title": "Biblioteca de derechos (EN/ES)",
  "bento.6.desc": "Guías claras citando la ley, en tu idioma.",
  "bento.7.title": "Demandas y quejas",
  "bento.7.desc": "Quejas pre-llenadas ante el regulador por cada violación detectada.",
  "bento.8.title": "Citas verificadas",
  "bento.8.desc": "Toda ley que citamos viene de una fuente real consultada al momento.",
  "footer.disclaimer.link": "Aviso",
  "footer.about.link": "Acerca",
  "footer.privacy.link": "Privacidad",
  "modal.title": "Antes de continuar",
  "modal.body.lead": `${BRAND.name} es una herramienta de autoayuda con IA, no un despacho de abogados.`,
  "modal.body.p1.head": "No hay relación abogado-cliente.",
  "modal.body.p1.text": `Usar ${BRAND.name} no crea una relación abogado-cliente con nadie.`,
  "modal.body.p2.head": "No hay confidencialidad.",
  "modal.body.p2.text": `Lo que compartes con ${BRAND.name} no está protegido por el secreto profesional.`,
  "modal.body.p3.head": "No sustituye a un abogado.",
  "modal.body.p3.text": `${BRAND.name} brinda información legal y borradores de documentos, no asesoramiento legal. Para decisiones que afecten tus derechos, consulta a un abogado licenciado en tu jurisdicción.`,
  "modal.body.tail": "Al continuar, confirmas que entiendes lo anterior.",
  "modal.cta": "Entiendo y acepto",
  "page.upload.title": "Subir",
  "page.case.title": "Caso",
  "page.map.title": "Mapa de depredadores",
  "page.coalition.title": "Coalición",
  "page.entity.title": "Perfil de entidad",
  "page.voice.title": "Voz y WhatsApp",
  "page.rights.title": "Tus derechos",
  "page.about.title": `Acerca de ${BRAND.name}`,
  "page.disclaimer.title": "Aviso legal",
  "soon": "Disponible muy pronto.",
  "soon.note": "Esta vista es parte del build de Lexor. El armazón, el sistema visual y las protecciones legales ya están activos; el flujo se enciende a continuación.",
  "cmdk.placeholder": "Escribe un comando o busca…",
  "cmdk.label": `Comandos de ${BRAND.name}`,
  "cmdk.empty": "Sin resultados.",
  "cmdk.close": "Cerrar",
  "cmdk.aria": "Paleta de comandos",
  "cmdk.group.go": "Ir a",
  "cmdk.group.actions": "Acciones",
  "cmdk.lang": "Cambiar idioma",
  "cmdk.call": `Llamar a ${BRAND.name}`,
  "cmdk.disclaimers": "Leer avisos legales",
  "cmdk.entity": "Buscar una entidad",
  "cmdk.new": "Nuevo caso",
  "about.lead": "Lexor reduce la asimetría de información del sistema legal — esa asimetría que permite que arrendadores, empleadores y cobradores se aprovechen de quienes no tienen abogados de $400/hora.",
  "about.body": "Cada carta que subes fortalece la red para la siguiente persona.",
  "attorney.section.title": "Encuentra un abogado licenciado",
  "attorney.section.body": `${BRAND.name} es información, no asesoramiento legal. Para decisiones que afecten tus derechos, consulta a un abogado licenciado en tu jurisdicción. Las líneas de referencia del colegio de abogados local y los directorios de ayuda legal son la vía más rápida.`,
  "notfound.title": "Página no encontrada",
  "notfound.body": "Esa página aún no es parte del build — revisa el menú o la paleta de comandos.",
  "notfound.cta": "Volver al inicio",
};

const dictionaries: Record<Locale, Dict> = { en, es };
export const dict = en;
const STORAGE_KEY = "lexor.locale";

function detectInitial(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "es") return stored;
  const nav = window.navigator.language?.toLowerCase() ?? "en";
  return nav.startsWith("es") ? "es" : "en";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
  t: (key: TKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitial());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const toggleLocale = useCallback(
    () => setLocaleState((cur) => (cur === "en" ? "es" : "en")),
    [],
  );

  const t = useCallback(
    (key: TKey) => dictionaries[locale][key] ?? dictionaries.en[key] ?? String(key),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside I18nProvider");
  return ctx;
}
