import type { SettlementCategoryKey } from "../types";

export const settlementCategoryOrder = ["matches", "wins", "losses"] as const satisfies readonly SettlementCategoryKey[];

export const settlementCategoryMeta = {
  matches: { label: "경기 수", unit: "판", color: "blue" },
  wins: { label: "승리 수", unit: "승", color: "green" },
  losses: { label: "패배 수", unit: "패", color: "orange" },
} satisfies Record<SettlementCategoryKey, { label: string; unit: string; color: string }>;
