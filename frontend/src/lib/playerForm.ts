import type { Gender, PlayerCreateInput, PlayerUpdateInput } from "../types";

export type PlayerFormValues = {
  username: string;
  password: string;
  gender: Gender;
  is_freshman: boolean;
  club_rank: string;
};

export function getDefaultClubRank(gender: Gender, isFreshman: boolean): number {
  if (gender === "M") {
    return isFreshman ? 5 : 4;
  }
  return isFreshman ? 7 : 6;
}

export function buildPlayerPayload(
  form: PlayerFormValues,
  editing: boolean,
): PlayerCreateInput | PlayerUpdateInput {
  if (form.club_rank.trim() === "") {
    throw new Error("부수는 -2부터 7 사이의 정수로 입력해 주세요.");
  }
  const clubRank = Number(form.club_rank);
  if (!Number.isInteger(clubRank) || clubRank < -2 || clubRank > 7) {
    throw new Error("부수는 -2부터 7 사이의 정수로 입력해 주세요.");
  }

  const player = {
    username: form.username,
    gender: form.gender,
    is_freshman: form.is_freshman,
    club_rank: clubRank,
  };

  return editing ? player : { ...player, password: form.password };
}
