export function TierBanner() {
  return (
    <div
      className="fixed bottom-16 left-0 right-0 z-40 flex items-center justify-center py-1.5 px-4 border-t pointer-events-none"
      style={{
        background: "rgba(10,15,12,0.95)",
        borderColor: "rgba(245,166,35,0.2)",
      }}
      role="status"
      aria-label="Free tier notice"
      data-testid="banner-free-tier"
    >
      <p
        className="text-[10px] font-mono tracking-wide text-center"
        style={{ color: "#F5A623" }}
      >
        Free tier · Not for evidentiary use
      </p>
    </div>
  );
}
