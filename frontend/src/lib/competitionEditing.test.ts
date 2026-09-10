import { describe, expect, it } from "vitest";

import type { CompetitionDetail, TeamDoublesMatch } from "../types";
import { competitionRosterChanges, doublesSnapshot } from "./competitionEditing";

describe("competition editing", () => {
  const league = {
    type: "league", members: [1, 2, 3, 4].map((id) => ({ id })),
  } as CompetitionDetail;
  const team = {
    type: "team",
    teams: [
      { name: "A", members: [1, 2, 3, 4].map((id) => ({ id })) },
      { name: "B", members: [5, 6, 7, 8].map((id) => ({ id })) },
    ],
  } as CompetitionDetail;

  it("omits the league roster when members were only reselected in a different order", () => {
    expect(competitionRosterChanges(league, [4, 3, 2, 1], [])).toEqual({});
    expect(competitionRosterChanges(league, [1, 2, 3, 5], [])).toEqual({ participant_ids: [1, 2, 3, 5] });
  });

  it("omits unchanged teams but sends actual transfers between teams", () => {
    const unchanged = [
      { name: "B", member_ids: [8, 7, 6, 5] },
      { name: "A", member_ids: [4, 3, 2, 1] },
    ];
    expect(competitionRosterChanges(team, [], unchanged)).toEqual({});
    const transferred = [
      { name: "A", member_ids: [1, 2, 3, 5] },
      { name: "B", member_ids: [4, 6, 7, 8] },
    ];
    expect(competitionRosterChanges(team, [], transferred)).toEqual({ teams: transferred });
  });

  it("sends changes to the team count or names", () => {
    const renamed = [
      { name: "C", member_ids: [1, 2, 3, 4] },
      { name: "B", member_ids: [5, 6, 7, 8] },
    ];
    expect(competitionRosterChanges(team, [], renamed)).toEqual({ teams: renamed });
    expect(competitionRosterChanges(team, [], renamed.slice(1))).toEqual({ teams: renamed.slice(1) });
  });

  it("keeps a doubles participant snapshot independent of later match changes", () => {
    const doubles = {
      id: 12,
      team1_players: [{ id: 1 }, { id: 2 }],
      team2_players: [{ id: 5 }, { id: 6 }],
    } as TeamDoublesMatch;
    const snapshot = doublesSnapshot(doubles);
    doubles.id = 13;
    doubles.team1_players[0].id = 3;
    doubles.team2_players.reverse();
    expect(snapshot).toEqual({ id: 12, team1_player_ids: [1, 2], team2_player_ids: [5, 6] });
  });
});
