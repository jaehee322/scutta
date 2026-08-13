import { Circle } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="SCUTTA">
      <span className="brand__mark" aria-hidden="true">
        <span className="brand__paddle" />
        <Circle className="brand__ball" strokeWidth={0} fill="currentColor" />
      </span>
      <span className="brand__word">SCUTTA</span>
    </div>
  );
}
