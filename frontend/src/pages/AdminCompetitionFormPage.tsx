import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import {
  competitionHasResults,
  competitionTeamNameUpdates,
  leagueSelectionError,
  teamNamesError,
  teamSelectionError,
} from "../lib/competition";
import type {
  CompetitionCreateInput,
  CompetitionDetail,
  CompetitionTeamInput,
  CompetitionType,
  CompetitionUpdateInput,
  UserRead,
} from "../types";

type TeamDraft = CompetitionTeamInput & { id?: number; key: number };

const initialTeams: TeamDraft[] = [
  { key: 1, name: "", member_ids: [] },
  { key: 2, name: "", member_ids: [] },
];

export function AdminCompetitionFormPage() {
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const editing = competitionId !== undefined;
  const parsedId = Number(competitionId);
  const [players, setPlayers] = useState<UserRead[]>([]);
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<CompetitionType>("league");
  const [participantIds, setParticipantIds] = useState<number[]>([]);
  const [teams, setTeams] = useState<TeamDraft[]>(initialTeams);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const requests: [Promise<UserRead[]>, Promise<CompetitionDetail | null>] = [
        apiRequest<UserRead[]>("/admin/players"),
        editing
          ? apiRequest<CompetitionDetail>(`/admin/competitions/${parsedId}`)
          : Promise.resolve(null),
      ];
      const [nextPlayers, nextDetail] = await Promise.all(requests);
      setPlayers(nextPlayers);
      if (nextDetail) {
        setDetail(nextDetail);
        setName(nextDetail.name);
        setType(nextDetail.type);
        if (nextDetail.type === "league") {
          setParticipantIds(nextDetail.members.map((member) => member.id));
        } else {
          setTeams(nextDetail.teams.map((team, index) => ({
            id: team.id,
            key: team.id || index + 1,
            name: team.name,
            member_ids: team.members.map((member) => member.id),
          })));
        }
      }
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [editing, parsedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPlayers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return players;
    return players.filter((player) => player.username.toLocaleLowerCase("ko-KR").includes(normalized));
  }, [players, query]);

  const rosterLocked = editing && competitionHasResults(detail);

  const toggleLeaguePlayer = (playerId: number) => {
    setParticipantIds((current) => {
      if (current.includes(playerId)) return current.filter((id) => id !== playerId);
      if (current.length >= 6) return current;
      return [...current, playerId];
    });
  };

  const toggleTeamPlayer = (teamKey: number, playerId: number) => {
    setTeams((current) => current.map((team) => {
      if (team.key !== teamKey) return team;
      if (team.member_ids.includes(playerId)) {
        return { ...team, member_ids: team.member_ids.filter((id) => id !== playerId) };
      }
      if (team.member_ids.length >= 4) return team;
      return { ...team, member_ids: [...team.member_ids, playerId] };
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("이름을 입력해 주세요.");
      return;
    }

    const normalizedTeams = teams.map(({ name: teamName, member_ids }) => ({
      name: teamName.trim(),
      member_ids,
    }));
    const namesError = type === "team" ? teamNamesError(normalizedTeams) : "";
    if (namesError) {
      setError(namesError);
      return;
    }
    const selectionError = type === "league"
      ? leagueSelectionError(participantIds)
      : teamSelectionError(normalizedTeams);
    if (!rosterLocked && selectionError) {
      setError(selectionError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (editing) {
        const payload: CompetitionUpdateInput = { name: trimmedName };
        if (rosterLocked && type === "team") {
          const teamNames = competitionTeamNameUpdates(teams);
          if (!teamNames) {
            setError("팀 정보가 올바르지 않습니다. 페이지를 다시 불러와 주세요.");
            return;
          }
          payload.team_names = teamNames;
        } else if (!rosterLocked) {
          if (type === "league") payload.participant_ids = participantIds;
          else payload.teams = normalizedTeams;
        }
        const result = await apiRequest<CompetitionDetail>(`/admin/competitions/${parsedId}`, {
          method: "PATCH",
          body: jsonBody(payload),
        });
        navigate(`/competitions/${result.id}`);
      } else {
        const payload: CompetitionCreateInput = type === "league"
          ? { name: trimmedName, type, participant_ids: participantIds }
          : { name: trimmedName, type, teams: normalizedTeams };
        const result = await apiRequest<CompetitionDetail>("/admin/competitions", {
          method: "POST",
          body: jsonBody(payload),
        });
        navigate(`/competitions/${result.id}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  const backTo = editing && Number.isInteger(parsedId) ? `/competitions/${parsedId}` : "/competitions";

  if (!loaded) {
    return (
      <div className="page">
        <Link className="back-link" to={backTo}><ArrowLeft size={18} /> 리그전</Link>
        <div className="page-load-error">
          <Notice>{error || "정보를 불러오지 못했습니다."}</Notice>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "불러오는 중" : "다시 불러오기"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Link className="back-link" to={backTo}><ArrowLeft size={18} /> 리그전</Link>
      <header className="admin-page-heading"><div><h1>{editing ? "리그전 수정" : "리그전 생성"}</h1></div></header>

      <form className="competition-form" onSubmit={submit}>
        <section className="competition-form-card">
          <label className="field"><span>이름</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
          {!editing && (
            <fieldset className="choice-group">
              <legend>종류</legend>
              <div className="choice-grid">
                <button type="button" aria-pressed={type === "league"} className={type === "league" ? "is-selected" : ""} onClick={() => setType("league")}>개인 리그</button>
                <button type="button" aria-pressed={type === "team"} className={type === "team" ? "is-selected" : ""} onClick={() => setType("team")}>단체전</button>
              </div>
            </fieldset>
          )}
        </section>

        {rosterLocked && (
          <Notice tone="info">
            {type === "team"
              ? "경기가 시작되어 선수 편성과 팀 수는 변경할 수 없습니다. 팀 이름은 수정할 수 있습니다."
              : "경기가 시작되어 참가 선수는 변경할 수 없습니다."}
          </Notice>
        )}

        {type === "league" ? (
          <section className="competition-form-card">
            <div className="competition-form-card__heading"><h2>참가 선수</h2><span>{participantIds.length}/6</span></div>
            {!rosterLocked && (
              <div className="input-shell competition-player-search"><Search size={19} /><input type="search" value={query} placeholder="선수 이름" onChange={(event) => setQuery(event.target.value)} /></div>
            )}
            <PlayerCheckGrid
              players={filteredPlayers}
              selectedIds={participantIds}
              disabled={rosterLocked}
              maxReached={participantIds.length >= 6}
              onToggle={toggleLeaguePlayer}
            />
          </section>
        ) : (
          <section className="competition-team-form-section">
            <div className="competition-form-section-heading">
              <h2>팀 편성</h2>
              {!rosterLocked && <button className="secondary-button" type="button" onClick={() => setTeams((current) => [...current, { key: Math.max(0, ...current.map((team) => team.key)) + 1, name: "", member_ids: [] }])}><Plus size={17} /> 팀 추가</button>}
            </div>
            <div className="competition-team-form-list">
              {teams.map((team, index) => {
                const usedByOtherTeams = new Set(teams.filter((item) => item.key !== team.key).flatMap((item) => item.member_ids));
                return (
                  <article className="competition-form-card" key={team.key}>
                    <div className="competition-team-form-card__topline">
                      <label className="field"><span>팀 {index + 1}</span><input value={team.name} disabled={saving} placeholder="팀 이름" maxLength={64} onChange={(event) => setTeams((current) => current.map((item) => item.key === team.key ? { ...item, name: event.target.value } : item))} required /></label>
                      {!rosterLocked && teams.length > 2 && <button className="small-icon-button is-danger" type="button" aria-label={`${index + 1}번 팀 삭제`} onClick={() => setTeams((current) => current.filter((item) => item.key !== team.key))}><Trash2 size={18} /></button>}
                    </div>
                    <div className="competition-form-card__heading"><h3>선수</h3><span>{team.member_ids.length}/4</span></div>
                    <PlayerCheckGrid
                      players={players}
                      selectedIds={team.member_ids}
                      disabled={rosterLocked}
                      disabledIds={usedByOtherTeams}
                      maxReached={team.member_ids.length >= 4}
                      onToggle={(playerId) => toggleTeamPlayer(team.key, playerId)}
                    />
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large competition-form-submit" disabled={saving}>
          {saving ? "저장하는 중" : "저장하기"}
        </button>
      </form>
    </div>
  );
}

function PlayerCheckGrid({
  players,
  selectedIds,
  disabled,
  disabledIds = new Set<number>(),
  maxReached,
  onToggle,
}: {
  players: UserRead[];
  selectedIds: number[];
  disabled: boolean;
  disabledIds?: Set<number>;
  maxReached: boolean;
  onToggle: (playerId: number) => void;
}) {
  if (!players.length) return <div className="competition-player-empty">선수가 없습니다.</div>;
  return (
    <div className="competition-player-check-grid">
      {players.map((player) => {
        const checked = selectedIds.includes(player.id);
        const optionDisabled = disabled || disabledIds.has(player.id) || (maxReached && !checked);
        return (
          <label key={player.id} className={checked ? "is-selected" : ""}>
            <input type="checkbox" checked={checked} disabled={optionDisabled} onChange={() => onToggle(player.id)} />
            <span><strong>{player.username}</strong><small>{player.club_rank}부</small></span>
          </label>
        );
      })}
    </div>
  );
}
