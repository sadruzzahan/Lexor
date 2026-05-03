import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getAdversary, type AdversaryDossier } from "@/lib/api";
import { DossierView } from "@/components/case/Adversary";
import { useDocumentTitle } from "@/lib/hooks";

export default function EntityPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [dossier, setDossier] = useState<AdversaryDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(
    dossier ? `${dossier.displayName} — Lexor` : "Adversary — Lexor",
  );

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getAdversary(id)
      .then((d) => alive && setDossier(d))
      .catch((e: unknown) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <section className="mx-auto max-w-5xl px-4 md:px-6 py-8 md:py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-6"
      >
        <ArrowLeft className="size-3.5" /> Home
      </Link>
      {loading && (
        <div className="min-h-[60vh] flex items-center justify-center text-fg-muted">
          <Loader2 className="animate-spin size-5 mr-2" /> Loading dossier…
        </div>
      )}
      {!loading && (error || !dossier) && (
        <div className="rounded-lg2 border border-dashed border-border-strong bg-bg-elevated/40 p-10 text-center">
          <div className="font-display text-xl text-fg">Dossier not found</div>
          <p className="mt-2 text-fg-muted text-sm">
            {error ?? "Try uploading a letter from this entity to populate it."}
          </p>
        </div>
      )}
      {!loading && dossier && (
        <DossierView dossier={dossier} hideUseDefense={true} />
      )}
    </section>
  );
}
