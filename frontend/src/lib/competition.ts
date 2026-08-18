import type {
  CompetitionDetail,
  CompetitionSummary,
  CompetitionTeam,
  CompetitionTeamInput,
  CompetitionTeamNameInput,
  CompetitionType,
} from "../types";

export type ResultOutcome = "win" | "loss";
export type ResultScore = "3:0" | "2:1";

export const competitionTypeLabel: Record<CompetitionType, string> = {
  league: "개인 리그",
  team: "단체전",
};

export function splitCompetitions(items: CompetitionSummary[]) {
  return {
    active: items.filter((item) => item.status === "active"),
    completed: items.filter((item) => item.status === "completed"),
  };
}

export function competitionProgress(item: Pick<CompetitionSummary, "completed_count" | "total_count">) {
  if (item.total_count <= 0) return 0;
  return Math.min(100, Math.max(0, (item.completed_count / item.total_count) * 100));
}

export function resultScorePair(outcome: ResultOutcome, score: ResultScore): [number, number] {
  const [winnerScore, loserScore] = score.split(":").map(Number) as [number, number];
  return outcome === "win" ? [winnerScore, loserScore] : [loserScore, winnerScore];
}

export function findPlayerTeam(teams: CompetitionTeam[], playerId: number | undefined) {
  if (playerId === undefined) return undefined;
  return teams.find((team) => team.members.some((member) => member.id === playerId));
}

export function competitionHasResults(detail: CompetitionDetail | null): boolean {
  if (!detail) return false;
  if (detail.type === "league") return detail.fixtures.some((fixture) => fixture.completed);
  return detail.encounters.some((encounter) => encounter.singles.length > 0 || encounter.doubles !== null);
}

export function isCompetitionDeleteConfirmed(
  competitionName: string,
  confirmation: string,
): boolean {
  return competitionName.length > 0 && confirmation === competitionName;
}

export function leagueSelectionError(participantIds: number[]): string {
  if (new Set(participantIds).size !== participantIds.length) return "같은 선수를 두 번 선택할 수 없습니다.";
  if (participantIds.length < 4 || participantIds.length > 6) return "선수를 4명에서 6명까지 선택해 주세요.";
  return "";
}

export function teamSelectionError(teams: CompetitionTeamInput[]): string {
  const namesError = teamNamesError(teams);
  if (namesError) return namesError;
  if (teams.length < 2) return "팀을 2개 이상 만들어 주세요.";
  if (teams.some((team) => team.member_ids.length !== 4)) return "각 팀에 선수 4명을 선택해 주세요.";

  const memberIds = teams.flatMap((team) => team.member_ids);
  if (new Set(memberIds).size !== memberIds.length) return "한 선수는 한 팀에만 들어갈 수 있습니다.";
  return "";
}

export function teamNamesError(teams: Array<{ name: string }>): string {
  const names = teams.map((team) => team.name.trim());
  if (names.some((name) => !name)) return "모든 팀 이름을 입력해 주세요.";
  if (names.some((name) => Array.from(name).length > 64)) {
    return "팀 이름은 64자 이하로 입력해 주세요.";
  }

  const normalizedNames = names.map((name) => name.normalize("NFKC").toLocaleLowerCase("ko-KR"));
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return "팀 이름은 대소문자와 관계없이 중복될 수 없습니다.";
  }
  return "";
}

export function competitionTeamNameUpdates(
  teams: Array<{ id?: number; name: string }>,
): CompetitionTeamNameInput[] | null {
  const updates: CompetitionTeamNameInput[] = [];
  for (const team of teams) {
    const { id } = team;
    if (id === undefined || !Number.isInteger(id) || id <= 0) return null;
    updates.push({ id, name: team.name.trim() });
  }
  return updates;
}
