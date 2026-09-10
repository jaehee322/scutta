import type {
  CompetitionDetail,
  CompetitionTeamInput,
  CompetitionUpdateInput,
  TeamDoublesMatch,
} from "../types";

function samePlayerIds(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const ordered = [...right].sort((a, b) => a - b);
  return [...left].sort((a, b) => a - b).every((id, index) => id === ordered[index]);
}

/** Omit unchanged rosters so a name edit preserves existing fixture IDs. */
export function competitionRosterChanges(
  detail: CompetitionDetail,
  participantIds: number[],
  teams: CompetitionTeamInput[],
): Pick<CompetitionUpdateInput, "participant_ids" | "teams"> {
  if (detail.type === "league") {
    return samePlayerIds(detail.members.map((member) => member.id), participantIds)
      ? {} : { participant_ids: participantIds };
  }
  const unchanged = detail.teams.length === teams.length && detail.teams.every((original) => {
    const draft = teams.find((team) => team.name === original.name);
    return draft !== undefined && samePlayerIds(original.members.map((member) => member.id), draft.member_ids);
  });
  return unchanged ? {} : { teams };
}

export function doublesSnapshot(doubles: TeamDoublesMatch) {
  return {
    id: doubles.id,
    team1_player_ids: doubles.team1_players.map((player) => player.id),
    team2_player_ids: doubles.team2_players.map((player) => player.id),
  };
}
