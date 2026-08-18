import { describe, expect, it } from "vitest";

import {
  competitionHasResults,
  competitionProgress,
  competitionTeamNameUpdates,
  isCompetitionDeleteConfirmed,
  leagueSelectionError,
  resultScorePair,
  splitCompetitions,
  teamSelectionError,
  teamNamesError,
} from "./competition";

describe("competition helpers", () => {
  it("splits active and completed competitions without changing their order", () => {
    const items = [
      { id: 1, status: "active" },
      { id: 2, status: "completed" },
      { id: 3, status: "active" },
    ] as Parameters<typeof splitCompetitions>[0];

    const result = splitCompetitions(items);

    expect(result.active.map((item) => item.id)).toEqual([1, 3]);
    expect(result.completed.map((item) => item.id)).toEqual([2]);
  });

  it("keeps progress between zero and one hundred", () => {
    expect(competitionProgress({ completed_count: 3, total_count: 10 })).toBe(30);
    expect(competitionProgress({ completed_count: 0, total_count: 0 })).toBe(0);
    expect(competitionProgress({ completed_count: 11, total_count: 10 })).toBe(100);
  });

  it("converts result choices into the current player's score", () => {
    expect(resultScorePair("win", "3:0")).toEqual([3, 0]);
    expect(resultScorePair("loss", "2:1")).toEqual([1, 2]);
  });

  it("requires four to six distinct league players", () => {
    expect(leagueSelectionError([1, 2, 3])).toBeTruthy();
    expect(leagueSelectionError([1, 2, 3, 4])).toBe("");
    expect(leagueSelectionError([1, 2, 3, 4, 5, 6])).toBe("");
    expect(leagueSelectionError([1, 2, 3, 4, 5, 6, 7])).toBeTruthy();
    expect(leagueSelectionError([1, 2, 3, 3])).toContain("두 번");
  });

  it("requires at least two distinct four-player teams", () => {
    expect(teamSelectionError([{ name: "A", member_ids: [1, 2, 3, 4] }])).toBeTruthy();
    expect(
      teamSelectionError([
        { name: "A", member_ids: [1, 2, 3, 4] },
        { name: "B", member_ids: [5, 6, 7, 8] },
      ]),
    ).toBe("");
    expect(
      teamSelectionError([
        { name: "A", member_ids: [1, 2, 3, 4] },
        { name: "B", member_ids: [4, 5, 6, 7] },
      ]),
    ).toContain("한 팀");
  });

  it("validates team names independently from locked rosters", () => {
    expect(teamNamesError([{ name: "" }, { name: "B" }])).toContain("모든 팀");
    expect(teamNamesError([{ name: "A".repeat(65) }, { name: "B" }])).toContain("64자");
    expect(teamNamesError([{ name: " SCUTTA " }, { name: "scutta" }])).toContain("중복");
    expect(teamNamesError([{ name: "Ａ팀" }, { name: "a팀" }])).toContain("중복");
    expect(teamNamesError([{ name: "ß" }, { name: "SS" }])).toBe("");
    expect(teamNamesError([{ name: "A팀" }, { name: "B팀" }])).toBe("");
  });

  it("builds atomic team-name updates only from persisted team ids", () => {
    expect(competitionTeamNameUpdates([
      { id: 41, name: " A팀 " },
      { id: 57, name: "B팀" },
    ])).toEqual([
      { id: 41, name: "A팀" },
      { id: 57, name: "B팀" },
    ]);
    expect(competitionTeamNameUpdates([{ name: "A팀" }])).toBeNull();
    expect(competitionTeamNameUpdates([{ id: 0, name: "A팀" }])).toBeNull();
  });

  it("detects partial team results before an encounter is complete", () => {
    const detail = {
      type: "team",
      encounters: [{ singles: [{ id: 1 }], doubles: null }],
    } as Parameters<typeof competitionHasResults>[0];
    expect(competitionHasResults(detail)).toBe(true);
  });

  it("requires the exact competition name before deletion", () => {
    expect(isCompetitionDeleteConfirmed("스컷타 리그", "스컷타 리그")).toBe(true);
    expect(isCompetitionDeleteConfirmed("스컷타 리그", " 스컷타 리그")).toBe(false);
    expect(isCompetitionDeleteConfirmed("스컷타 리그", "스컷타 리그 ")).toBe(false);
    expect(isCompetitionDeleteConfirmed("스컷타 리그", "스컷타 리그  ")).toBe(false);
    expect(isCompetitionDeleteConfirmed("", "")).toBe(false);
  });
});
