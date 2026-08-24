import { describe, expect, it } from "vitest";

import type { MatchRead } from "../types";
import { formatKoreanDateTime, getMatchPerspective, toMatchScore } from "./match";

const match: MatchRead = {
  id: 1,
  player1: { id: 3, username: "민지" },
  player2: { id: 9, username: "준호" },
  score1: 2,
  score2: 1,
  winner_id: 3,
  loser_id: 9,
  kind: "casual",
  played_on: "2026-08-14",
  played_at: null,
};

describe("match helpers", () => {
  it("shows a canonical match from the current player's perspective", () => {
    expect(getMatchPerspective(match, 9)).toEqual({
      opponentName: "민지",
      opponentId: 3,
      myScore: 1,
      opponentScore: 2,
      won: false,
    });
  });

  it("maps outcome controls to the API score payload", () => {
    expect(toMatchScore("win", "3:0")).toEqual({ my_score: 3, opponent_score: 0 });
    expect(toMatchScore("loss", "2:1")).toEqual({ my_score: 1, opponent_score: 2 });
  });

  it("adds Seoul hour and minute only when an exact played time exists", () => {
    expect(formatKoreanDateTime("2026-08-25", null)).not.toContain(":");
    expect(formatKoreanDateTime("2026-08-25", "2026-08-25T06:07:00+00:00"))
      .toMatch(/15:07$/);
  });
});
