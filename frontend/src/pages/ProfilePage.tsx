import {
  ArrowRight,
  CalendarDays,
  DatabaseZap,
  KeyRound,
  LogOut,
  Medal,
  Settings2,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import { formatKoreanDate, getMatchPerspective } from "../lib/match";
import type { MatchListResponse, PlayerWithStats } from "../types";

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<PlayerWithStats | null>(null);
  const [matches, setMatches] = useState<MatchListResponse | null>(null);
  const [error, setError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (user?.role !== "player") return;
    try {
      const [nextProfile, nextMatches] = await Promise.all([
        apiRequest<PlayerWithStats>("/players/me"),
        apiRequest<MatchListResponse>("/matches?limit=50"),
      ]);
      setProfile(nextProfile);
      setMatches(nextMatches);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "내 정보를 불러오지 못했습니다.");
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await apiRequest<{ message: string }>("/auth/password", {
        method: "PATCH",
        body: jsonBody({ current_password: currentPassword, new_password: newPassword }),
      });
      setMessage(response.message);
      setCurrentPassword("");
      setNewPassword("");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    try {
      await logout();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그아웃하지 못했습니다.");
    }
  };

  if (user?.role === "player" && !profile && !error) return <PageLoader />;

  return (
    <div className="page profile-page">
      <section className="profile-hero">
        <div className="profile-avatar">{user?.username.slice(0, 1)}</div>
        <div>
          <span className="eyebrow">MY SCUTTA</span>
          <h1>{user?.username}</h1>
          <p>
            {user?.role === "admin"
              ? "SCUTTA 관리자"
              : `${profile?.club_rank}부 · ${profile?.is_freshman ? "신입 부원" : "SCUTTA 부원"}`}
          </p>
        </div>
        <span className={`role-badge ${user?.role === "admin" ? "is-admin" : ""}`}>
          {user?.role === "admin" ? <ShieldCheck size={16} /> : <Medal size={16} />}
          {user?.role === "admin" ? "관리자" : "선수"}
        </span>
      </section>

      {error && <Notice>{error}</Notice>}

      {profile && (
        <section className="profile-stats">
          <div><span>경기</span><strong>{profile.stats.matches}</strong></div>
          <div><span>승리</span><strong>{profile.stats.wins}</strong></div>
          <div><span>패배</span><strong>{profile.stats.losses}</strong></div>
          <div><span>상대</span><strong>{profile.stats.opponents}</strong></div>
        </section>
      )}

      {user?.role === "admin" && (
        <section className="admin-entry-card">
          <div className="section-icon section-icon--blue"><Settings2 size={22} /></div>
          <div>
            <span>관리자 전용</span>
            <h2>선수와 경기 기록 관리</h2>
            <p>선수 등록, 비밀번호 초기화, 경기 수정과 학기 초기화를 할 수 있어요.</p>
          </div>
          <a href="#admin-console" className="primary-button">관리 화면 열기 <ArrowRight size={18} /></a>
        </section>
      )}

      {matches && (
        <section className="profile-history card">
          <header className="card-title-row">
            <div>
              <span className="eyebrow">HISTORY</span>
              <h2>내 경기 기록</h2>
            </div>
            <span className="muted-count">총 {matches.total}경기</span>
          </header>
          {!matches.items.length ? (
            <div className="empty-state">
              <span className="empty-state__icon"><CalendarDays size={24} /></span>
              <strong>아직 경기 기록이 없어요</strong>
            </div>
          ) : (
            <div className="history-table">
              {matches.items.map((match) => {
                const view = getMatchPerspective(match, user!.id);
                return (
                  <article key={match.id}>
                    <span className={`result-badge ${view.won ? "is-win" : "is-loss"}`}>
                      {view.won ? "승" : "패"}
                    </span>
                    <div><strong>{view.opponentName}</strong><span>{formatKoreanDate(match.played_on)}</span></div>
                    <strong className="history-score">{view.myScore} : {view.opponentScore}</strong>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="settings-list">
        <button type="button" onClick={() => setPasswordOpen(true)}>
          <span className="settings-list__icon"><KeyRound size={20} /></span>
          <div><strong>비밀번호 변경</strong><small>현재 비밀번호를 알고 있을 때 변경할 수 있어요.</small></div>
          <ArrowRight size={18} />
        </button>
        <button type="button" className="is-danger" onClick={() => void handleLogout()}>
          <span className="settings-list__icon"><LogOut size={20} /></span>
          <div><strong>로그아웃</strong><small>이 기기에서 로그인 정보를 지워요.</small></div>
          <ArrowRight size={18} />
        </button>
      </section>

      {passwordOpen && (
        <Modal title="비밀번호 변경" description="새 비밀번호는 8자 이상 입력해 주세요." onClose={() => setPasswordOpen(false)}>
          <form className="modal-form" onSubmit={handlePassword}>
            <label className="field"><span>현재 비밀번호</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={8} required /></label>
            <label className="field"><span>새 비밀번호</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></label>
            {message && <Notice tone={message.includes("변경했습니다") ? "success" : "error"}>{message}</Notice>}
            <button className="primary-button primary-button--large" disabled={submitting}>{submitting ? "변경하는 중" : "변경하기"}</button>
          </form>
        </Modal>
      )}

      {user?.role === "admin" && <AdminConsole />}
    </div>
  );
}

function AdminConsole() {
  return (
    <section className="admin-console-anchor" id="admin-console">
      <div className="admin-console-heading">
        <span className="section-icon section-icon--blue"><UserRoundCog size={23} /></span>
        <div><span className="eyebrow">ADMIN</span><h2>관리자 콘솔</h2><p>선수와 경기, 학기 데이터를 한곳에서 관리하세요.</p></div>
      </div>
      <div className="admin-quick-grid">
        <AdminPlayers />
        <AdminMatches />
        <AdminReset />
      </div>
    </section>
  );
}

function AdminPlayers() {
  return <AdminFeatureCard icon={<UserRoundCog size={22} />} title="선수 관리" description="등록·수정·비밀번호 초기화" href="/admin/players" />;
}

function AdminMatches() {
  return <AdminFeatureCard icon={<DatabaseZap size={22} />} title="경기 관리" description="오기입 수정과 삭제" href="/admin/matches" />;
}

function AdminReset() {
  return <AdminFeatureCard icon={<DatabaseZap size={22} />} title="학기 초기화" description="모든 선수와 경기 제거" href="/admin/reset" danger />;
}

function AdminFeatureCard({ icon, title, description, href, danger = false }: { icon: ReactNode; title: string; description: string; href: string; danger?: boolean }) {
  return (
    <a className={`admin-feature-card ${danger ? "is-danger" : ""}`} href={href}>
      <span>{icon}</span><div><strong>{title}</strong><small>{description}</small></div><ArrowRight size={18} />
    </a>
  );
}
