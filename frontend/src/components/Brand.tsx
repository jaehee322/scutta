export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <img
        className="brand__logo"
        src={compact ? "/scutta-logo.png" : "/scutta-university-logo.png"}
        alt={compact ? "SCUTTA" : "서울대학교 탁구동아리 SCUTTA"}
        width={compact ? 255 : 509}
        height={compact ? 237 : 360}
      />
    </div>
  );
}
