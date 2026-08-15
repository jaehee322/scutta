import type { Gender, PlayerCreateInput, PlayerUpdateInput } from "../types";

export type PlayerFormValues = {
  username: string;
  password: string;
  gender: Gender;
  is_freshman: boolean;
  club_rank: string;
};

export function buildPlayerPayload(
  form: PlayerFormValues,
  editing: boolean,
): PlayerCreateInput | PlayerUpdateInput {
  const clubRank = Number(form.club_rank);
  if (!Number.isInteger(clubRank) || clubRank < 1) {
    throw new Error("부수는 1 이상의 정수로 입력해 주세요.");
  }

  const player = {
    username: form.username,
    gender: form.gender,
    is_freshman: form.is_freshman,
    club_rank: clubRank,
  };

  return editing ? player : { ...player, password: form.password };
}
