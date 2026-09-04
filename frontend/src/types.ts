export type UserRole = "player" | "admin";
export type Gender = "M" | "F";
export type MatchKind = "casual" | "daily" | "competition";
export type RankingCategory = "matches" | "wins" | "losses" | "opponents";
export type SettlementCategoryKey = Exclude<RankingCategory, "opponents">;
export type CompetitionType = "league" | "team";
export type CompetitionStatus = "active" | "completed";

export interface UserRead {
  id: number;
  username: string;
  role: UserRole;
  gender: Gender | null;
  is_freshman: boolean;
  club_rank: number | null;
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
  played_at: string | null;
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

export type CoinSide = "heads" | "tails";

export interface CoinFlipState {
  active: boolean;
  run_id: number;
  current_streak: number;
  best_streak: number;
  remaining_attempts: number;
}

export interface CoinFlipRankingEntry {
  rank: number;
  user_id: number;
  username: string;
  best_streak: number;
}

export interface CoinFlipSnapshot {
  state: CoinFlipState;
  ranking: CoinFlipRankingEntry[];
}

export interface CoinFlipResult extends CoinFlipSnapshot {
  result: CoinSide;
  correct: boolean;
  game_over: boolean;
  final_score: number | null;
}

export interface PaddleFlightRankingEntry {
  rank: number;
  user_id: number;
  username: string;
  best_score: number;
}

export interface PaddleFlightOverview {
  best_score: number;
  ranking: PaddleFlightRankingEntry[];
}

export interface SettlementCategory {
  category: SettlementCategoryKey;
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

export interface SettlementSettings {
  prizes: Record<SettlementCategoryKey, string>;
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

export type MinigameResetGame = "coin-flip" | "paddle-flight";

export interface MinigameResetPreview {
  game: MinigameResetGame;
  record_count: number;
  confirmation_required: string;
}

export interface MinigameResetResponse {
  game: MinigameResetGame;
  deleted_records: number;
  message: string;
}

export interface CompetitionSummary {
  id: number;
  name: string;
  type: CompetitionType;
  status: CompetitionStatus;
  completed_count: number;
  total_count: number;
  is_participant: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitionPlayerRef {
  id: number;
  username: string;
  club_rank: number | null;
}

export interface LeagueStanding {
  rank: number;
  player: CompetitionPlayerRef;
  played: number;
  wins: number;
  losses: number;
  sets_won: number;
  sets_lost: number;
  set_difference: number;
}

export interface LeagueFixture {
  id: number;
  round_no: number;
  order_no: number;
  player1: CompetitionPlayerRef;
  player2: CompetitionPlayerRef;
  score1: number | null;
  score2: number | null;
  played_on: string | null;
  played_at: string | null;
  winner_id: number | null;
  completed: boolean;
  can_submit: boolean;
}

export interface LeagueCompetitionDetail extends Omit<CompetitionSummary, "type"> {
  type: "league";
  members: CompetitionPlayerRef[];
  standings: LeagueStanding[];
  fixtures: LeagueFixture[];
}

export interface CompetitionTeamRef {
  id: number;
  name: string;
}

export interface CompetitionTeam extends CompetitionTeamRef {
  members: CompetitionPlayerRef[];
}

export interface TeamStanding {
  rank: number;
  team: CompetitionTeamRef;
  played: number;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  game_difference: number;
}

export interface TeamSingleMatch {
  id: number;
  sequence: number;
  team1_player: CompetitionPlayerRef;
  team2_player: CompetitionPlayerRef;
  score1: number;
  score2: number;
  played_on: string;
  played_at: string | null;
  winner_team_id: number;
}

export interface TeamDoublesMatch {
  id: number;
  team1_players: CompetitionPlayerRef[];
  team2_players: CompetitionPlayerRef[];
  score1: number | null;
  score2: number | null;
  played_on: string | null;
  played_at: string | null;
  winner_team_id: number | null;
  completed: boolean;
}

export interface TeamEncounter {
  id: number;
  round_no: number;
  order_no: number;
  team1: CompetitionTeamRef;
  team2: CompetitionTeamRef;
  singles: TeamSingleMatch[];
  doubles: TeamDoublesMatch | null;
  team1_wins: number;
  team2_wins: number;
  winner_team_id: number | null;
  completed: boolean;
  available_team1_players: CompetitionPlayerRef[];
  available_team2_players: CompetitionPlayerRef[];
  can_submit_singles: boolean;
  can_submit_doubles: boolean;
}

export interface TeamCompetitionDetail extends Omit<CompetitionSummary, "type"> {
  type: "team";
  teams: CompetitionTeam[];
  standings: TeamStanding[];
  encounters: TeamEncounter[];
}

export type CompetitionDetail = LeagueCompetitionDetail | TeamCompetitionDetail;

export interface CompetitionTeamInput {
  name: string;
  member_ids: number[];
}

export interface CompetitionTeamNameInput {
  id: number;
  name: string;
}

export interface CompetitionUpdateInput {
  name: string;
  participant_ids?: number[];
  teams?: CompetitionTeamInput[];
  team_names?: CompetitionTeamNameInput[];
}

export type CompetitionCreateInput =
  | { name: string; type: "league"; participant_ids: number[] }
  | { name: string; type: "team"; teams: CompetitionTeamInput[] };

export type PlayerCreateInput = {
  username: string;
  password: string;
  gender: Gender;
  is_freshman: boolean;
  club_rank: number;
};

export type PlayerUpdateInput = Partial<Omit<PlayerCreateInput, "password">>;

export type ApiValidationIssue = {
  loc?: Array<string | number>;
  msg?: string;
};

export type ApiErrorBody = {
  detail?: string | ApiValidationIssue[];
};
