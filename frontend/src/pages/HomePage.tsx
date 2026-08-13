import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  Swords,
  Trophy,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import { formatKoreanDate, getMatchPerspective, toMatchScore } from "../lib/match";
import type { MatchListResponse, PlayerSummary, PlayerWithStats } from "../types";

type Outcome = "win" | "loss";
type MatchScore = "3:0" | "2:1";

const statMeta = [
  { key: "matches", label: "경기", suffix: "판" },
  { key: "wins", label: "승리", suffix: "승" },
  { key: "losses", label: "패배", suffix: "패" },
  { key: "opponents", label: "만난 상대", suffix: "명" },
] as const;

export function HomePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<PlayerWithStats | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [matches, setMatches] = useState<MatchListResponse | null>(null);
  const [opponentId, setOpponentId] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("win");
  const [score, setScore] = useState<MatchScore>("3:0");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextProfile, nextPlayers, nextMatches] = await Promise.all([
        apiRequest<PlayerWithStats>("/players/me"),
        apiRequest<PlayerSummary[]>("/players?exclude_self=true"),
        apiRequest<MatchListResponse>("/matches?limit=5"),
      ]);
      setProfile(nextProfile);
      setPlayers(nextPlayers);
      setMatches(nextMatches);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedOpponent = useMemo(
    () => players.find((player) => String(player.id) === opponentId),
    [opponentId, players],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!opponentId) {
      setError("상대를 먼저 선택해 주세요.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await apiRequest("/matches", {
        method: "POST",
        body: jsonBody({ opponent_id: Number(opponentId), ...toMatchScore(outcome, score) }),
      });
      setSuccess(`${selectedOpponent?.username ?? "상대"}님과의 경기를 기록했어요.`);
      setOpponentId("");
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError("오늘은 이 상대와 이미 경기를 기록했어요.");
      } else {
        setError(caught instanceof Error ? caught.message : "경기를 기록하지 못했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page home-page">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">오늘도 즐거운 탁구</span>
          <h1>{user?.username}님, 경기 준비됐나요?</h1>
          <p>방금 끝난 경기를 간단하게 기록해 보세요.</p>
        </div>
        <div className="welcome-illustration" aria-hidden="true">
          <div className="welcome-illustration__ball" />
          <div className="welcome-illustration__paddle">
            <span />
          </div>
        </div>
      </section>

      {profile && (
        <section className="stats-strip" aria-label="내 누적 기록">
          {statMeta.map(({ key, label, suffix }) => (
            <div key={key} className="stat-item">
              <span>{label}</span>
              <strong>
                {profile.stats[key]}
                <small>{suffix}</small>
              </strong>
            </div>
          ))}
        </section>
      )}

      <div className="home-grid">
        <section className="card submit-card">
          <header className="section-heading">
            <div className="section-icon section-icon--blue">
              <Swords size={22} />
            </div>
            <div>
              <span>경기 결과 제출</span>
              <h2>오늘의 한 게임을 남겨요</h2>
            </div>
          </header>

          <form onSubmit={handleSubmit}>
            <label className="field">
              <span>누구와 경기했나요?</span>
              <div className="select-shell">
                <CircleUserRound size={20} />
                <select
                  value={opponentId}
                  onChange={(event) => setOpponentId(event.target.value)}
                  required
                >
                  <option value="">상대를 선택하세요</option>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.username} · {player.club_rank}부
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} />
              </div>
            </label>

            <fieldset className="choice-group">
              <legend>경기 결과</legend>
              <div className="choice-grid">
                <button
                  type="button"
                  className={outcome === "win" ? "is-selected" : ""}
                  onClick={() => setOutcome("win")}
                  aria-pressed={outcome === "win"}
                >
                  <Trophy size={20} />
                  내가 이겼어요
                  {outcome === "win" && <Check className="choice-check" size={16} />}
                </button>
                <button
                  type="button"
                  className={outcome === "loss" ? "is-selected" : ""}
                  onClick={() => setOutcome("loss")}
                  aria-pressed={outcome === "loss"}
                >
                  <UsersRound size={20} />
                  상대가 이겼어요
                  {outcome === "loss" && <Check className="choice-check" size={16} />}
                </button>
              </div>
            </fieldset>

            <fieldset className="choice-group">
              <legend>스코어</legend>
              <div className="score-choice">
                {(["3:0", "2:1"] as MatchScore[]).map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={score === option ? "is-selected" : ""}
                    onClick={() => setScore(option)}
                    aria-pressed={score === option}
                  >
                    <strong>{option}</strong>
                    <span>{option === "3:0" ? "완승" : "접전"}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <Notice>{error}</Notice>}
            {success && <Notice tone="success">{success}</Notice>}

            <button className="primary-button primary-button--large" disabled={submitting}>
              {submitting ? "기록하는 중" : "경기 기록하기"}
              {!submitting && <ArrowRight size={20} />}
            </button>
            <p className="form-hint">같은 상대와의 경기는 하루에 한 번만 기록할 수 있어요.</p>
          </form>
        </section>

        <section className="card recent-card">
          <header className="card-title-row">
            <div>
              <span className="eyebrow">RECENT</span>
              <h2>최근 경기</h2>
            </div>
            <Link to="/profile" className="text-link">
              전체 기록 <ArrowRight size={16} />
            </Link>
          </header>

          {!matches?.items.length ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <CalendarDays size={25} />
              </span>
              <strong>아직 기록한 경기가 없어요</strong>
              <p>첫 경기를 제출하면 이곳에 바로 나타나요.</p>
            </div>
          ) : (
            <div className="match-list">
              {matches.items.map((match) => {
                const view = getMatchPerspective(match, user!.id);
                return (
                  <article className="match-row" key={match.id}>
                    <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                      {view.won ? "승" : "패"}
                    </span>
                    <div className="match-row__opponent">
                      <strong>{view.opponentName}</strong>
                      <span>{formatKoreanDate(match.played_on)}</span>
                    </div>
                    <div className="match-row__score" aria-label={`${view.myScore} 대 ${view.opponentScore}`}>
                      <strong>{view.myScore}</strong>
                      <span>:</span>
                      <strong>{view.opponentScore}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
