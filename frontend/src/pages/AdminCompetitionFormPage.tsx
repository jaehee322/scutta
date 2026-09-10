import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { CompetitionPlayerPicker } from "../components/CompetitionPlayerPicker";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import {
  competitionHasResults,
  competitionTeamName,
  leagueSelectionError,
  teamNamesError,
  teamSelectionError,
} from "../lib/competition";
import { competitionRosterChanges } from "../lib/competitionEditing";
import type {
  CompetitionCreateInput,
  CompetitionDetail,
  CompetitionTeamInput,
  CompetitionType,
  CompetitionUpdateInput,
  UserRead,
} from "../types";

type TeamDraft = CompetitionTeamInput & { key: number };

const initialTeams: TeamDraft[] = [
  { key: 1, name: "A", member_ids: [] },
  { key: 2, name: "B", member_ids: [] },
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

  const rosterLocked = editing && competitionHasResults(detail);

  const addTeam = () => {
    if (rosterLocked || saving) return;
    setTeams((current) => {
      const usedNames = new Set(current.map((team) => team.name.trim().normalize("NFKC").toLocaleUpperCase("ko-KR")));
      let nameIndex = 0;
      while (usedNames.has(competitionTeamName(nameIndex))) nameIndex += 1;
      return [...current, {
        key: Math.max(0, ...current.map((team) => team.key)) + 1,
        name: competitionTeamName(nameIndex),
        member_ids: [],
      }];
    });
  };

  const removeTeam = (teamKey: number) => {
    if (rosterLocked || saving) return;
    setTeams((current) => current.length <= 2 ? current : current
      .filter((team) => team.key !== teamKey)
      .map((team, index) => editing ? team : { ...team, name: competitionTeamName(index) }));
  };

  const addLeaguePlayer = (playerId: number) => {
    if (rosterLocked || saving) return;
    setParticipantIds((current) => {
      if (current.includes(playerId) || current.length >= 6) return current;
      return [...current, playerId];
    });
  };

  const addTeamPlayer = (teamKey: number, playerId: number) => {
    if (rosterLocked || saving) return;
    setTeams((current) => {
      if (current.some((team) => team.member_ids.includes(playerId))) return current;
      return current.map((team) => team.key === teamKey && team.member_ids.length < 4
        ? { ...team, member_ids: [...team.member_ids, playerId] }
        : team);
    });
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
        if (!rosterLocked && detail) {
          Object.assign(payload, competitionRosterChanges(detail, participantIds, normalizedTeams));
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
          <label className="field"><span>이름</span><input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
          {!editing && (
            <fieldset className="choice-group">
              <legend>종류</legend>
              <div className="choice-grid">
                <button type="button" disabled={saving} aria-pressed={type === "league"} className={type === "league" ? "is-selected" : ""} onClick={() => setType("league")}>개인 리그</button>
                <button type="button" disabled={saving} aria-pressed={type === "team"} className={type === "team" ? "is-selected" : ""} onClick={() => setType("team")}>단체전</button>
              </div>
            </fieldset>
          )}
        </section>

        {rosterLocked && (
          <Notice tone="info">
            {type === "team"
              ? "경기가 시작되어 선수 편성과 팀 수는 변경할 수 없습니다."
              : "경기가 시작되어 참가 선수는 변경할 수 없습니다."}
          </Notice>
        )}

        {type === "league" ? (
          <section className="competition-form-card">
            <div className="competition-form-card__heading"><h2>참가 선수</h2><span aria-live="polite">{participantIds.length}/4~6</span></div>
            <CompetitionPlayerPicker
              players={players}
              selectedIds={participantIds}
              label="참가 선수"
              maxPlayers={6}
              locked={rosterLocked}
              disabled={saving}
              onAdd={addLeaguePlayer}
              onRemove={(playerId) => setParticipantIds((current) => current.filter((id) => id !== playerId))}
            />
          </section>
        ) : (
          <section className="competition-team-form-section">
            <div className="competition-form-section-heading">
              <h2>팀 편성</h2>
              {!rosterLocked && <button className="secondary-button" type="button" disabled={saving} onClick={addTeam}><Plus size={17} /> 팀 추가</button>}
            </div>
            <div className="competition-team-form-list">
              {teams.map((team, index) => {
                const usedByOtherTeams = new Set(teams.filter((item) => item.key !== team.key).flatMap((item) => item.member_ids));
                return (
                  <article className="competition-form-card" key={team.key}>
                    <div className="competition-team-form-card__topline">
                      <h3 className="competition-team-form-name">{team.name}</h3>
                      {!rosterLocked && teams.length > 2 && <button className="small-icon-button is-danger" type="button" disabled={saving} aria-label={`${index + 1}번 팀 삭제`} onClick={() => removeTeam(team.key)}><Trash2 size={18} /></button>}
                    </div>
                    <div className="competition-form-card__heading"><h3>선수</h3><span aria-live="polite">{team.member_ids.length}/4</span></div>
                    <CompetitionPlayerPicker
                      players={players}
                      selectedIds={team.member_ids}
                      label={`팀 ${index + 1} 선수`}
                      maxPlayers={4}
                      locked={rosterLocked}
                      disabled={saving}
                      unavailableIds={usedByOtherTeams}
                      onAdd={(playerId) => addTeamPlayer(team.key, playerId)}
                      onRemove={(playerId) => setTeams((current) => current.map((item) => item.key === team.key
                        ? { ...item, member_ids: item.member_ids.filter((id) => id !== playerId) }
                        : item))}
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
