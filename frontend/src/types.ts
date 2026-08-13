export type UserRole = "player" | "admin";
export type Gender = "M" | "F";
export type MatchKind = "casual" | "daily" | "competition";
export type RankingCategory = "matches" | "wins" | "losses" | "opponents";

export interface UserRead {
  id: number;
  username: string;
  role: UserRole;
  gender: Gender | null;
  is_freshman: boolean;
  club_rank: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlayerSummary {
  id: number;
  username: string;
  gender: Gender | null;
  is_freshman: boolean;
  club_rank: number | null;
}

export interface PlayerStats {
  matches: number;
  wins: number;
  losses: number;
  opponents: number;
}

export interface PlayerWithStats extends PlayerSummary {
  stats: PlayerStats;
}

export interface MatchParticipant {
  id: number;
  username: string;
}

export interface MatchRead {
  id: number;
  player1: MatchParticipant;
  player2: MatchParticipant;
  score1: number;
  score2: number;
  winner_id: number;
  loser_id: number;
  kind: MatchKind;
  played_on: string;
  submitted_by_id: number;
  updated_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchListResponse {
  items: MatchRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface RankingEntry {
  rank: number;
  player: PlayerSummary;
  value: number;
}

export interface RankingTable {
  category: RankingCategory;
  entries: RankingEntry[];
}

export interface RankingsResponse {
  categories: RankingTable[];
}

export interface SettlementCategory {
  category: RankingCategory;
  prize: string;
  value: number;
  tickets: number;
  total_tickets: number;
  probability_percent: number;
}

export interface SettlementResponse {
  draws: string[];
  categories: SettlementCategory[];
}

export interface DatabaseResetCounts {
  matches: number;
  competition_members: number;
  competitions: number;
  players: number;
  player_sessions: number;
}

export interface DatabaseResetPreview extends DatabaseResetCounts {
  confirmation_required: string;
  preserved_admins: number;
  preserved_admin_sessions: number;
}

export interface DatabaseResetResponse {
  message: string;
  deleted: DatabaseResetCounts;
}

export interface PasswordResetResponse {
  message: string;
  revoked_sessions: number;
}

export type PlayerCreateInput = {
  username: string;
  password: string;
  gender: Gender;
  is_freshman: boolean;
  club_rank: number;
  is_active: boolean;
};

export type PlayerUpdateInput = Partial<Omit<PlayerCreateInput, "password">>;

export type ApiValidationIssue = {
  loc?: Array<string | number>;
  msg?: string;
};

export type ApiErrorBody = {
  detail?: string | ApiValidationIssue[];
};
