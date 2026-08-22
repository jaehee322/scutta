import {
  ArrowLeft,
  Check,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoader } from "../components/Loading";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import {
  competitionTypeLabel,
  findPlayerTeam,
  isCompetitionDeleteConfirmed,
  type ResultOutcome,
  type ResultScore,
  resultScorePair,
} from "../lib/competition";
import { formatKoreanDate } from "../lib/match";
import type {
  CompetitionDetail,
  CompetitionPlayerRef,
  LeagueCompetitionDetail,
  LeagueFixture,
  TeamCompetitionDetail,
  TeamDoublesMatch,
  TeamEncounter,
  TeamSingleMatch,
} from "../types";

type AllowedScore = "3:0" | "2:1" | "1:2" | "0:3";

export function CompetitionDetailPage() {
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const parsedId = Number(competitionId);
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const requestDetail = useCallback(async () => {
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new Error("리그전 번호가 올바르지 않습니다.");
    }
    const prefix = user?.role === "admin" ? "/admin/competitions" : "/competitions";
    return apiRequest<CompetitionDetail>(`${prefix}/${parsedId}`);
  }, [parsedId, user?.role]);

  const reload = useCallback(async () => {
    const nextDetail = await requestDetail();
    setDetail(nextDetail);
    setError("");
  }, [requestDetail]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "리그전을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !detail) return <PageLoader />;

  if (!detail) {
    return (
      <div className="page competition-detail-page">
        <Link className="back-link" to="/competitions"><ArrowLeft size={18} /> 리그전</Link>
        <div className="page-load-error">
          <Notice>{error || "리그전을 찾을 수 없습니다."}</Notice>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "불러오는 중" : "다시 불러오기"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page competition-detail-page">
      <Link className="back-link" to="/competitions"><ArrowLeft size={18} /> 리그전</Link>

      <section className="competition-detail-hero">
        <p className="competition-detail-hero__meta">
          {competitionTypeLabel[detail.type]} · {detail.status === "active" ? "진행 중" : "종료"}
        </p>
        <div className="competition-detail-hero__title">
          <h1>{detail.name}</h1>
          {user?.role === "admin" && (
            <div className="competition-admin-actions">
              <Link className="secondary-button" to={`/admin/competitions/${detail.id}/edit`}>
                <Pencil size={17} /> 수정
              </Link>
              <button
                className="secondary-button competition-delete-trigger"
                type="button"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={17} /> 삭제
              </button>
              {detail.status === "active" && (
                <button className="primary-button" type="button" onClick={() => setCompleteOpen(true)}>
                  <Check size={17} /> 마감
                </button>
              )}
            </div>
          )}
        </div>
        <div className="competition-progress-copy">
          <span>경기</span>
          <strong>{detail.completed_count} / {detail.total_count}</strong>
        </div>
      </section>

      {error && <Notice>{error}</Notice>}

      {detail.type === "league" ? (
        <LeagueDetail detail={detail} isAdmin={user?.role === "admin"} currentUserId={user?.id} reload={reload} />
      ) : (
        <TeamDetail detail={detail} isAdmin={user?.role === "admin"} currentUserId={user?.id} reload={reload} />
      )}

      {completeOpen && (
        <CompleteCompetitionModal
          detail={detail}
          onClose={() => setCompleteOpen(false)}
          onCompleted={async () => {
            await reload();
            setCompleteOpen(false);
          }}
        />
      )}
      {deleteOpen && (
        <DeleteCompetitionModal
          detail={detail}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => navigate("/competitions", { replace: true })}
        />
      )}
    </div>
  );
}

function DeleteCompetitionModal({
  detail,
  onClose,
  onDeleted,
}: {
  detail: CompetitionDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const confirmed = isCompetitionDeleteConfirmed(detail.name, confirmation);

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (deleting || !confirmed) return;

    setDeleting(true);
    setError("");
    try {
      await apiRequest(`/admin/competitions/${detail.id}`, { method: "DELETE" });
      onDeleted();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        onDeleted();
        return;
      }
      setError(caught instanceof Error ? caught.message : "대회를 삭제하지 못했습니다.");
      setDeleting(false);
    }
  };

  return (
    <Modal
      title="대회를 삭제할까요?"
      description="대회와 연결된 모든 경기 결과가 함께 삭제됩니다."
      onClose={onClose}
      closeDisabled={deleting}
    >
      <form className="competition-delete-form" onSubmit={remove}>
        <div className="competition-delete-warning" role="note">
          <strong>{detail.name}</strong>
          <span>
            단식 결과는 랭킹과 정산 기록에서도 제거되며, 단식·복식 결과를 포함한
            대회 데이터는 복구할 수 없습니다.
          </span>
        </div>
        <label className="field">
          <span>확인을 위해 대회명을 정확히 입력해 주세요.</span>
          <input
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={detail.name}
            autoComplete="off"
            spellCheck={false}
            disabled={deleting}
            autoFocus
          />
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" disabled={deleting} onClick={onClose}>
            취소
          </button>
          <button
            className="danger-button"
            type="submit"
            disabled={deleting || !confirmed}
            aria-busy={deleting}
          >
            {deleting ? "삭제하는 중" : "대회 삭제"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteCompetitionModal({
  detail,
  onClose,
  onCompleted,
}: {
  detail: CompetitionDetail;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [mutationApplied, setMutationApplied] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true);
    setError("");
    let applied = mutationApplied;
    try {
      if (!applied) {
        await apiRequest(`/admin/competitions/${detail.id}/complete`, { method: "POST" });
        applied = true;
        setMutationApplied(true);
      }
      await onCompleted();
    } catch (caught) {
      setError(
        applied
          ? "마감은 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "마감하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="리그전을 마감할까요?" onClose={onClose} closeDisabled={saving || mutationApplied}>
      <div className="confirm-match">
        <strong>{detail.name}</strong>
        <span>{detail.completed_count} / {detail.total_count}경기 완료</span>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <button className="secondary-button" type="button" disabled={saving || mutationApplied} onClick={onClose}>취소</button>
        <button className="primary-button" type="button" disabled={saving} onClick={() => void submit()}>
          {saving
            ? mutationApplied ? "불러오는 중" : "마감하는 중"
            : mutationApplied ? "최신 정보 불러오기" : "마감하기"}
        </button>
      </div>
    </Modal>
  );
}

function LeagueDetail({
  detail,
  isAdmin,
  currentUserId,
  reload,
}: {
  detail: LeagueCompetitionDetail;
  isAdmin: boolean;
  currentUserId: number | undefined;
  reload: () => Promise<void>;
}) {
  return (
    <div className="competition-detail-sections">
      <section className="competition-panel">
        <PanelHeading title="순위" />
        <div className="competition-table-wrap" role="table" aria-label="개인 리그 순위">
          <div className="league-standing-row league-standing-row--header" role="row">
            <span role="columnheader">순위</span><span role="columnheader">선수</span><span role="columnheader">경기</span><span role="columnheader">승</span><span role="columnheader">패</span><span role="columnheader">세트</span>
          </div>
          {detail.standings.map((standing) => (
            <div
              key={standing.player.id}
              className={`league-standing-row ${standing.player.id === currentUserId ? "is-me" : ""}`}
              role="row"
            >
              <strong role="cell">{standing.rank}</strong>
              <span className="standing-name" role="cell">
                <b>{standing.player.username}</b><small>{standing.player.club_rank}부</small>
              </span>
              <span role="cell">{standing.played}</span><span role="cell">{standing.wins}</span><span role="cell">{standing.losses}</span>
              <span role="cell" className={standing.set_difference > 0 ? "is-positive" : ""}>
                {standing.sets_won}:{standing.sets_lost}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="competition-panel">
        <PanelHeading title="대진" count={`${detail.completed_count}/${detail.total_count}`} />
        <div className="league-fixture-list">
          {detail.fixtures.map((fixture) => (
            <LeagueFixtureRow
              key={fixture.id}
              competitionId={detail.id}
              fixture={fixture}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              active={detail.status === "active"}
              reload={reload}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function LeagueFixtureRow({
  competitionId,
  fixture,
  isAdmin,
  currentUserId,
  active,
  reload,
}: {
  competitionId: number;
  fixture: LeagueFixture;
  isAdmin: boolean;
  currentUserId: number | undefined;
  active: boolean;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const opponent = fixture.player1.id === currentUserId ? fixture.player2 : fixture.player1;

  const retryReload = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await reload();
      setReloadRequired(false);
    } catch {
      setDeleteError("삭제는 완료되었습니다. 최신 정보를 다시 불러오지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const remove = async () => {
    if (deleting || editing || reloadRequired) return;
    if (!window.confirm("경기 결과를 삭제할까요?")) return;
    setDeleting(true);
    setDeleteError("");
    let applied = false;
    try {
      await apiRequest(`/admin/competitions/${competitionId}/league-fixtures/${fixture.id}/result`, { method: "DELETE" });
      applied = true;
      setReloadRequired(true);
      await reload();
      setReloadRequired(false);
    } catch (caught) {
      setDeleteError(
        applied
          ? "삭제는 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "결과를 삭제하지 못했습니다.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="competition-match-row">
      <span className="competition-round">{fixture.round_no}R</span>
      <div className="competition-match-players">
        <strong className={fixture.winner_id === fixture.player1.id ? "is-winner" : ""}>{fixture.player1.username}</strong>
        <small>vs</small>
        <strong className={fixture.winner_id === fixture.player2.id ? "is-winner" : ""}>{fixture.player2.username}</strong>
      </div>
      <div className="competition-match-result">
        {fixture.completed ? (
          <><strong>{fixture.score1} : {fixture.score2}</strong><small>{formatKoreanDate(fixture.played_on!)}</small></>
        ) : <span>예정</span>}
      </div>
      <div className="competition-match-actions">
        {!isAdmin && active && fixture.can_submit && (
          <button className="small-primary-button" type="button" onClick={() => setEditing(true)}>결과 입력</button>
        )}
        {isAdmin && (
          <>
            <button className="small-icon-button" type="button" aria-label="결과 수정" disabled={deleting || editing || reloadRequired} onClick={() => setEditing(true)}>
              {fixture.completed ? <Pencil size={17} /> : <Plus size={17} />}
            </button>
            {fixture.completed && (
              <button className="small-icon-button is-danger" type="button" aria-label="결과 삭제" aria-busy={deleting} onClick={() => void remove()} disabled={deleting || editing || reloadRequired}>
                <Trash2 size={17} />
              </button>
            )}
          </>
        )}
      </div>
      {deleteError && (
        <div className="competition-row-error">
          <Notice>{deleteError}</Notice>
          {reloadRequired && (
            <button className="small-primary-button" type="button" disabled={deleting} onClick={() => void retryReload()}>
              {deleting ? "불러오는 중" : "최신 정보 불러오기"}
            </button>
          )}
        </div>
      )}
      {editing && (
        isAdmin ? (
          <AdminLeagueResultModal
            competitionId={competitionId}
            fixture={fixture}
            onClose={() => setEditing(false)}
            onSaved={reload}
          />
        ) : (
          <PlayerResultModal
            title={`${opponent.username} 경기`}
            submitPath={`/competitions/${competitionId}/league-fixtures/${fixture.id}/result`}
            onClose={() => setEditing(false)}
            onSaved={reload}
          />
        )
      )}
    </article>
  );
}

function AdminLeagueResultModal({
  competitionId,
  fixture,
  onClose,
  onSaved,
}: {
  competitionId: number;
  fixture: LeagueFixture;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initialScore = fixture.completed ? `${fixture.score1}:${fixture.score2}` as AllowedScore : "3:0";
  return (
    <AdminScoreModal
      title={`${fixture.player1.username} · ${fixture.player2.username}`}
      initialScore={initialScore}
      initialDate={fixture.played_on ?? seoulDateInputValue()}
      onClose={onClose}
      onSubmit={async (score1, score2, playedOn) => {
        await apiRequest(`/admin/competitions/${competitionId}/league-fixtures/${fixture.id}/result`, {
          method: "PUT",
          body: jsonBody({ score1, score2, played_on: playedOn }),
        });
      }}
      onSaved={onSaved}
    />
  );
}

function TeamDetail({
  detail,
  isAdmin,
  currentUserId,
  reload,
}: {
  detail: TeamCompetitionDetail;
  isAdmin: boolean;
  currentUserId: number | undefined;
  reload: () => Promise<void>;
}) {
  const myTeam = findPlayerTeam(detail.teams, currentUserId);
  return (
    <div className="competition-detail-sections">
      <section className="competition-panel">
        <PanelHeading title="순위" />
        <div className="competition-table-wrap" role="table" aria-label="단체전 순위">
          <div className="team-standing-row team-standing-row--header" role="row">
            <span role="columnheader">순위</span><span role="columnheader">팀</span><span role="columnheader">경기</span><span role="columnheader">승</span><span role="columnheader">패</span><span role="columnheader">게임</span>
          </div>
          {detail.standings.map((standing) => (
            <div key={standing.team.id} className={`team-standing-row ${standing.team.id === myTeam?.id ? "is-me" : ""}`} role="row">
              <strong role="cell">{standing.rank}</strong><b role="cell">{standing.team.name}</b><span role="cell">{standing.played}</span>
              <span role="cell">{standing.wins}</span><span role="cell">{standing.losses}</span>
              <span role="cell" className={standing.game_difference > 0 ? "is-positive" : ""}>{standing.games_won}:{standing.games_lost}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="competition-panel">
        <PanelHeading title="대진" count={`${detail.completed_count}/${detail.total_count}`} />
        <div className="team-encounter-list">
          {detail.encounters.map((encounter) => (
            <TeamEncounterCard
              key={encounter.id}
              competitionId={detail.id}
              encounter={encounter}
              detail={detail}
              myTeamId={myTeam?.id}
              isAdmin={isAdmin}
              active={detail.status === "active"}
              reload={reload}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TeamEncounterCard({
  competitionId,
  encounter,
  detail,
  myTeamId,
  isAdmin,
  active,
  reload,
}: {
  competitionId: number;
  encounter: TeamEncounter;
  detail: TeamCompetitionDetail;
  myTeamId: number | undefined;
  isAdmin: boolean;
  active: boolean;
  reload: () => Promise<void>;
}) {
  const [addingSingles, setAddingSingles] = useState(false);
  const [editingSingle, setEditingSingle] = useState<TeamSingleMatch | null>(null);
  const [editingDoubles, setEditingDoubles] = useState(false);
  const [error, setError] = useState("");
  const [deletingAction, setDeletingAction] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const actionBlocked = deletingAction !== null || reloadRequired;

  const retryReload = async () => {
    if (deletingAction !== null) return;
    setError("");
    setDeletingAction("reload");
    try {
      await reload();
      setReloadRequired(false);
    } catch {
      setError("삭제는 완료되었습니다. 최신 정보를 다시 불러오지 못했습니다.");
    } finally {
      setDeletingAction(null);
    }
  };

  const remove = async (path: string, label: string, actionKey: string) => {
    if (actionBlocked) return;
    if (!window.confirm(`${label} 결과를 삭제할까요?`)) return;
    setError("");
    setDeletingAction(actionKey);
    let applied = false;
    try {
      await apiRequest(path, { method: "DELETE" });
      applied = true;
      setReloadRequired(true);
      await reload();
      setReloadRequired(false);
    } catch (caught) {
      setError(
        applied
          ? "삭제는 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "결과를 삭제하지 못했습니다.",
      );
    } finally {
      setDeletingAction(null);
    }
  };

  const team1 = detail.teams.find((team) => team.id === encounter.team1.id)!;
  const team2 = detail.teams.find((team) => team.id === encounter.team2.id)!;

  return (
    <article className="team-encounter-card">
      <header className="team-encounter-card__header">
        <span>{encounter.round_no}R</span>
        <div><strong>{encounter.team1.name}</strong><b>{encounter.team1_wins} : {encounter.team2_wins}</b><strong>{encounter.team2.name}</strong></div>
        <small>{encounter.completed ? "완료" : `${encounter.singles.length}/4 단식`}</small>
      </header>

      <div className="team-game-list">
        {encounter.singles.map((single) => (
          <div className="team-game-row" key={single.id}>
            <span>단식 {single.sequence}</span>
            <div><strong>{single.team1_player.username}</strong><small>vs</small><strong>{single.team2_player.username}</strong></div>
            <b>{single.score1} : {single.score2}</b>
            {isAdmin && (
              <div className="competition-match-actions">
                <button className="small-icon-button" type="button" aria-label="단식 수정" disabled={actionBlocked} onClick={() => setEditingSingle(single)}><Pencil size={16} /></button>
                <button
                  className="small-icon-button is-danger"
                  type="button"
                  aria-label="단식 삭제"
                  aria-busy={deletingAction === `single-${single.id}`}
                  disabled={actionBlocked}
                  onClick={() => void remove(`/admin/competitions/${competitionId}/team-singles/${single.id}`, `단식 ${single.sequence}`, `single-${single.id}`)}
                ><Trash2 size={16} /></button>
              </div>
            )}
          </div>
        ))}

        {encounter.doubles && (
          <div className="team-game-row team-game-row--doubles">
            <span>복식</span>
            <div>
              <strong>{playerNames(encounter.doubles.team1_players)}</strong>
              <small>vs</small>
              <strong>{playerNames(encounter.doubles.team2_players)}</strong>
            </div>
            <b>{encounter.doubles.completed ? `${encounter.doubles.score1} : ${encounter.doubles.score2}` : "예정"}</b>
            {(isAdmin || (active && encounter.can_submit_doubles)) && (
              <div className="competition-match-actions">
                <button className={isAdmin ? "small-icon-button" : "small-primary-button"} type="button" aria-label={isAdmin ? "복식 결과 수정" : undefined} disabled={actionBlocked} onClick={() => setEditingDoubles(true)}>
                  {isAdmin ? <Pencil size={16} /> : "결과 입력"}
                </button>
                {isAdmin && encounter.doubles.completed && (
                  <button
                    className="small-icon-button is-danger"
                    type="button"
                    aria-label="복식 삭제"
                    aria-busy={deletingAction === "doubles"}
                    disabled={actionBlocked}
                    onClick={() => void remove(`/admin/competitions/${competitionId}/team-encounters/${encounter.id}/doubles`, "복식", "doubles")}
                  ><Trash2 size={16} /></button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {active && (isAdmin
        ? encounter.singles.length < 4 && encounter.available_team1_players.length > 0 && encounter.available_team2_players.length > 0
        : encounter.can_submit_singles) && (
        <button className="team-add-game-button" type="button" disabled={actionBlocked} onClick={() => setAddingSingles(true)}>
          <Plus size={17} /> 단식 결과 입력
        </button>
      )}
      {error && (
        <div className="competition-row-error">
          <Notice>{error}</Notice>
          {reloadRequired && (
            <button className="small-primary-button" type="button" disabled={deletingAction !== null} onClick={() => void retryReload()}>
              {deletingAction === "reload" ? "불러오는 중" : "최신 정보 불러오기"}
            </button>
          )}
        </div>
      )}

      {addingSingles && (
        <TeamSinglesModal
          competitionId={competitionId}
          encounter={encounter}
          team1Members={team1.members}
          team2Members={team2.members}
          myTeamId={myTeamId}
          isAdmin={isAdmin}
          onClose={() => setAddingSingles(false)}
          onSaved={reload}
        />
      )}
      {editingSingle && (
        <TeamSinglesModal
          competitionId={competitionId}
          encounter={encounter}
          team1Members={team1.members}
          team2Members={team2.members}
          myTeamId={myTeamId}
          isAdmin
          single={editingSingle}
          onClose={() => setEditingSingle(null)}
          onSaved={reload}
        />
      )}
      {editingDoubles && encounter.doubles && (
        <TeamDoublesModal
          competitionId={competitionId}
          encounter={encounter}
          doubles={encounter.doubles}
          myTeamId={myTeamId}
          isAdmin={isAdmin}
          onClose={() => setEditingDoubles(false)}
          onSaved={reload}
        />
      )}
    </article>
  );
}

function TeamSinglesModal({
  competitionId,
  encounter,
  team1Members,
  team2Members,
  myTeamId,
  isAdmin,
  single,
  onClose,
  onSaved,
}: {
  competitionId: number;
  encounter: TeamEncounter;
  team1Members: CompetitionPlayerRef[];
  team2Members: CompetitionPlayerRef[];
  myTeamId: number | undefined;
  isAdmin: boolean;
  single?: TeamSingleMatch;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const team1Options = single
    ? uniquePlayers([single.team1_player, ...encounter.available_team1_players])
    : encounter.available_team1_players;
  const team2Options = single
    ? uniquePlayers([single.team2_player, ...encounter.available_team2_players])
    : encounter.available_team2_players;
  const [team1PlayerId, setTeam1PlayerId] = useState(single?.team1_player.id ?? team1Options[0]?.id ?? 0);
  const [team2PlayerId, setTeam2PlayerId] = useState(single?.team2_player.id ?? team2Options[0]?.id ?? 0);
  const [score, setScore] = useState<AllowedScore>(single ? `${single.score1}:${single.score2}` as AllowedScore : "3:0");
  const [outcome, setOutcome] = useState<ResultOutcome>("win");
  const [resultScore, setResultScore] = useState<ResultScore>("3:0");
  const [playedOn, setPlayedOn] = useState(single?.played_on ?? seoulDateInputValue());
  const [saving, setSaving] = useState(false);
  const [mutationApplied, setMutationApplied] = useState(false);
  const [error, setError] = useState("");
  const mySide = myTeamId === encounter.team1.id ? 1 : myTeamId === encounter.team2.id ? 2 : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    let applied = mutationApplied;
    try {
      if (!applied) {
        if (isAdmin) {
          const [score1, score2] = score.split(":").map(Number);
          const path = single
            ? `/admin/competitions/${competitionId}/team-singles/${single.id}`
            : `/admin/competitions/${competitionId}/team-encounters/${encounter.id}/singles`;
          await apiRequest(path, {
            method: single ? "PUT" : "POST",
            body: jsonBody({ team1_player_id: team1PlayerId, team2_player_id: team2PlayerId, score1, score2, played_on: playedOn }),
          });
        } else {
          if (mySide === null) throw new Error("참가 팀을 확인하지 못했습니다.");
          const [myTeamScore, opponentTeamScore] = resultScorePair(outcome, resultScore);
          await apiRequest(`/competitions/${competitionId}/team-encounters/${encounter.id}/singles`, {
            method: "POST",
            body: jsonBody({
              my_team_player_id: mySide === 1 ? team1PlayerId : team2PlayerId,
              opponent_team_player_id: mySide === 1 ? team2PlayerId : team1PlayerId,
              my_team_score: myTeamScore,
              opponent_team_score: opponentTeamScore,
            }),
          });
        }
        applied = true;
        setMutationApplied(true);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        applied
          ? "저장은 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "결과를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const ownOptions = mySide === 2 ? team2Options : team1Options;
  const opponentOptions = mySide === 2 ? team1Options : team2Options;
  const ownValue = mySide === 2 ? team2PlayerId : team1PlayerId;
  const opponentValue = mySide === 2 ? team1PlayerId : team2PlayerId;

  return (
    <Modal title={single ? "단식 결과 수정" : "단식 결과 입력"} onClose={onClose} closeDisabled={saving || mutationApplied}>
      <form className="modal-form" onSubmit={submit}>
        {!mutationApplied && (
          <>
            {isAdmin ? (
              <div className="form-row">
                <PlayerSelect label={encounter.team1.name} players={team1Options.length ? team1Options : team1Members} value={team1PlayerId} onChange={setTeam1PlayerId} />
                <PlayerSelect label={encounter.team2.name} players={team2Options.length ? team2Options : team2Members} value={team2PlayerId} onChange={setTeam2PlayerId} />
              </div>
            ) : (
              <div className="form-row">
                <PlayerSelect
                  label="우리 팀 선수"
                  players={ownOptions}
                  value={ownValue}
                  onChange={(value) => { if (mySide === 2) setTeam2PlayerId(value); else setTeam1PlayerId(value); }}
                />
                <PlayerSelect
                  label="상대 팀 선수"
                  players={opponentOptions}
                  value={opponentValue}
                  onChange={(value) => { if (mySide === 2) setTeam1PlayerId(value); else setTeam2PlayerId(value); }}
                />
              </div>
            )}
            {isAdmin ? (
              <AdminScoreFields score={score} onScoreChange={setScore} playedOn={playedOn} onDateChange={setPlayedOn} />
            ) : (
              <ResultPicker outcome={outcome} score={resultScore} onOutcomeChange={setOutcome} onScoreChange={setResultScore} />
            )}
          </>
        )}
        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large" disabled={saving || (!mutationApplied && (!team1PlayerId || !team2PlayerId))}>
          {saving
            ? mutationApplied ? "불러오는 중" : "저장하는 중"
            : mutationApplied ? "최신 정보 불러오기" : "저장하기"}
        </button>
      </form>
    </Modal>
  );
}

function TeamDoublesModal({
  competitionId,
  encounter,
  doubles,
  myTeamId,
  isAdmin,
  onClose,
  onSaved,
}: {
  competitionId: number;
  encounter: TeamEncounter;
  doubles: TeamDoublesMatch;
  myTeamId: number | undefined;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initial = doubles.completed ? `${doubles.score1}:${doubles.score2}` as AllowedScore : "3:0";
  const title = `${playerNames(doubles.team1_players)} · ${playerNames(doubles.team2_players)}`;
  if (isAdmin) {
    return (
      <AdminScoreModal
        title={title}
        initialScore={initial}
        initialDate={doubles.played_on ?? seoulDateInputValue()}
        onClose={onClose}
        onSubmit={async (score1, score2, playedOn) => {
          await apiRequest(`/admin/competitions/${competitionId}/team-encounters/${encounter.id}/doubles`, {
            method: "PUT",
            body: jsonBody({ score1, score2, played_on: playedOn }),
          });
        }}
        onSaved={onSaved}
      />
    );
  }
  if (myTeamId !== encounter.team1.id && myTeamId !== encounter.team2.id) return null;
  return (
    <PlayerResultModal
      title={title}
      submitPath={`/competitions/${competitionId}/team-encounters/${encounter.id}/doubles`}
      payloadKeys={["my_team_score", "opponent_team_score"]}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function PlayerResultModal({
  title,
  submitPath,
  payloadKeys = ["my_score", "opponent_score"],
  onClose,
  onSaved,
}: {
  title: string;
  submitPath: string;
  payloadKeys?: [string, string];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ResultOutcome>("win");
  const [score, setScore] = useState<ResultScore>("3:0");
  const [saving, setSaving] = useState(false);
  const [mutationApplied, setMutationApplied] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const [myScore, opponentScore] = resultScorePair(outcome, score);
    let applied = mutationApplied;
    try {
      if (!applied) {
        await apiRequest(submitPath, {
          method: "POST",
          body: jsonBody({ [payloadKeys[0]]: myScore, [payloadKeys[1]]: opponentScore }),
        });
        applied = true;
        setMutationApplied(true);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        applied
          ? "저장은 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "결과를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} closeDisabled={saving || mutationApplied}>
      <form className="modal-form" onSubmit={submit}>
        {!mutationApplied && <ResultPicker outcome={outcome} score={score} onOutcomeChange={setOutcome} onScoreChange={setScore} />}
        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large" disabled={saving}>
          {saving
            ? mutationApplied ? "불러오는 중" : "저장하는 중"
            : mutationApplied ? "최신 정보 불러오기" : "저장하기"}
        </button>
      </form>
    </Modal>
  );
}

function AdminScoreModal({
  title,
  initialScore,
  initialDate,
  onClose,
  onSubmit,
  onSaved,
}: {
  title: string;
  initialScore: AllowedScore;
  initialDate: string;
  onClose: () => void;
  onSubmit: (score1: number, score2: number, playedOn: string) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [score, setScore] = useState(initialScore);
  const [playedOn, setPlayedOn] = useState(initialDate);
  const [saving, setSaving] = useState(false);
  const [mutationApplied, setMutationApplied] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const [score1, score2] = score.split(":").map(Number);
    let applied = mutationApplied;
    try {
      if (!applied) {
        await onSubmit(score1, score2, playedOn);
        applied = true;
        setMutationApplied(true);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        applied
          ? "저장은 완료되었습니다. 아래 버튼으로 최신 정보를 다시 불러와 주세요."
          : caught instanceof Error ? caught.message : "결과를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} closeDisabled={saving || mutationApplied}>
      <form className="modal-form" onSubmit={submit}>
        {!mutationApplied && <AdminScoreFields score={score} onScoreChange={setScore} playedOn={playedOn} onDateChange={setPlayedOn} />}
        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large" disabled={saving}>
          {saving
            ? mutationApplied ? "불러오는 중" : "저장하는 중"
            : mutationApplied ? "최신 정보 불러오기" : "저장하기"}
        </button>
      </form>
    </Modal>
  );
}

function ResultPicker({
  outcome,
  score,
  onOutcomeChange,
  onScoreChange,
}: {
  outcome: ResultOutcome;
  score: ResultScore;
  onOutcomeChange: (value: ResultOutcome) => void;
  onScoreChange: (value: ResultScore) => void;
}) {
  return (
    <>
      <fieldset className="choice-group">
        <legend>결과</legend>
        <div className="choice-grid">
          <button type="button" aria-pressed={outcome === "win"} className={outcome === "win" ? "is-selected" : ""} onClick={() => onOutcomeChange("win")}>승리</button>
          <button type="button" aria-pressed={outcome === "loss"} className={outcome === "loss" ? "is-selected" : ""} onClick={() => onOutcomeChange("loss")}>패배</button>
        </div>
      </fieldset>
      <fieldset className="choice-group">
        <legend>점수</legend>
        <div className="score-choice">
          <button type="button" aria-pressed={score === "3:0"} className={score === "3:0" ? "is-selected" : ""} onClick={() => onScoreChange("3:0")}><strong>3 : 0</strong></button>
          <button type="button" aria-pressed={score === "2:1"} className={score === "2:1" ? "is-selected" : ""} onClick={() => onScoreChange("2:1")}><strong>2 : 1</strong></button>
        </div>
      </fieldset>
    </>
  );
}

function AdminScoreFields({
  score,
  onScoreChange,
  playedOn,
  onDateChange,
}: {
  score: AllowedScore;
  onScoreChange: (value: AllowedScore) => void;
  playedOn: string;
  onDateChange: (value: string) => void;
}) {
  return (
    <div className="form-row">
      <label className="field"><span>점수</span><select value={score} onChange={(event) => onScoreChange(event.target.value as AllowedScore)}><option value="3:0">3 : 0</option><option value="2:1">2 : 1</option><option value="1:2">1 : 2</option><option value="0:3">0 : 3</option></select></label>
      <label className="field"><span>날짜</span><input type="date" value={playedOn} onChange={(event) => onDateChange(event.target.value)} required /></label>
    </div>
  );
}

function PlayerSelect({
  label,
  players,
  value,
  onChange,
}: {
  label: string;
  players: CompetitionPlayerRef[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))} required>{players.map((player) => <option key={player.id} value={player.id}>{player.username}</option>)}</select></label>
  );
}

function PanelHeading({ title, count }: { title: string; count?: ReactNode }) {
  return <header className="competition-panel__heading"><h2>{title}</h2>{count && <span>{count}</span>}</header>;
}

function uniquePlayers(players: CompetitionPlayerRef[]) {
  return players.filter((player, index) => players.findIndex((candidate) => candidate.id === player.id) === index);
}

function playerNames(players: CompetitionPlayerRef[]) {
  return players.map((player) => player.username).join(" · ");
}

function seoulDateInputValue() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
