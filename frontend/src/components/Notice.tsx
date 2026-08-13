import { CheckCircle2, CircleAlert } from "lucide-react";

export function Notice({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: string;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "success" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <span>{children}</span>
    </div>
  );
}
