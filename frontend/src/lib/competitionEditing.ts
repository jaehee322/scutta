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

/** Send name-only edits by team ID so existing rosters and fixtures are preserved. */
export function competitionRosterChanges(
  detail: CompetitionDetail,
  participantIds: number[],
  teams: Array<CompetitionTeamInput & { id: number }>,
): Pick<CompetitionUpdateInput, "participant_ids" | "teams" | "team_names"> {
  if (detail.type === "league") {
    return samePlayerIds(detail.members.map((member) => member.id), participantIds)
      ? {} : { participant_ids: participantIds };
  }
  const unchanged = detail.teams.length === teams.length && detail.teams.every((original) => {
    const draft = teams.find((team) => team.id === original.id);
    return draft !== undefined && samePlayerIds(original.members.map((member) => member.id), draft.member_ids);
  });
  if (!unchanged) return { teams: teams.map(({ name, member_ids }) => ({ name, member_ids })) };
  const renamed = detail.teams.some((original) => teams.find((team) => team.id === original.id)?.name !== original.name);
  return renamed ? { team_names: teams.map(({ id, name }) => ({ id, name })) } : {};
}

export function doublesSnapshot(doubles: TeamDoublesMatch) {
  return {
    id: doubles.id,
    team1_player_ids: doubles.team1_players.map((player) => player.id),
    team2_player_ids: doubles.team2_players.map((player) => player.id),
  };
}
