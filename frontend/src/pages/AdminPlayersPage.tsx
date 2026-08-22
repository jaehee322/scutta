import { ArrowLeft, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { Modal } from "../components/Modal";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import { buildPlayerPayload, type PlayerFormValues } from "../lib/playerForm";
import type { Gender, UserRead } from "../types";

const initialPlayer: PlayerFormValues = {
  username: "",
  password: "",
  gender: "M",
  is_freshman: false,
  club_rank: "",
};

export function AdminPlayersPage() {
  const [players, setPlayers] = useState<UserRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRead | null>(null);
  const [resetting, setResetting] = useState<UserRead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRead | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setPlayers(await apiRequest<UserRead[]>("/admin/players"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선수 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <Link className="back-link" to="/"><ArrowLeft size={18} /> 홈</Link>
      <header className="admin-page-heading">
        <div><h1>선수 관리</h1></div>
        <button className="primary-button" type="button" disabled={Boolean(error && !players.length)} onClick={() => setCreateOpen(true)}><Plus size={18} /> 선수 등록</button>
      </header>
      {error && (
        <div className="page-load-error">
          <Notice>{error}</Notice>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCw size={17} /> 다시 불러오기
          </button>
        </div>
      )}
      {(!error || players.length > 0) && <section className="admin-list-card">
        <div className="admin-list-card__summary"><strong>선수 {players.length}명</strong></div>
        <div className="admin-player-list">
          {players.map((player) => (
            <article key={player.id}>
              <span className="avatar-circle">{player.username.slice(0, 1)}</span>
              <div className="admin-player-main"><strong>{player.username}</strong><span>{player.club_rank}부 · {player.gender === "F" ? "여" : "남"}{player.is_freshman ? " · 신입" : ""}</span></div>
              <div className="admin-row-actions">
                <button type="button" onClick={() => setResetting(player)} aria-label={`${player.username} 비밀번호 초기화`}><KeyRound size={18} /></button>
                <button type="button" onClick={() => setEditing(player)} aria-label={`${player.username} 수정`}><Pencil size={18} /></button>
                <button className="is-danger" type="button" onClick={() => setDeleteTarget(player)} aria-label={`${player.username} 삭제`}><Trash2 size={18} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>}
      {createOpen && <PlayerFormModal title="새 선수 등록" initial={initialPlayer} onClose={() => setCreateOpen(false)} onSaved={load} />}
      {editing && <PlayerFormModal title="선수 정보 수정" initial={{ username: editing.username, password: "", gender: editing.gender ?? "M", is_freshman: editing.is_freshman, club_rank: String(editing.club_rank ?? 1) }} playerId={editing.id} onClose={() => setEditing(null)} onSaved={load} />}
      {resetting && <PasswordResetModal player={resetting} onClose={() => setResetting(null)} />}
      {deleteTarget && <DeletePlayerModal player={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={load} />}
    </div>
  );
}

function PlayerFormModal({ title, initial, playerId, onClose, onSaved }: { title: string; initial: PlayerFormValues; playerId?: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = buildPlayerPayload(form, playerId !== undefined);
      await apiRequest(playerId ? `/admin/players/${playerId}` : "/admin/players", { method: playerId ? "PATCH" : "POST", body: jsonBody(payload) });
      await onSaved(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); } finally { setSaving(false); }
  };
  return (
    <Modal title={title} description="이름은 로그인 아이디로 사용돼요." onClose={onClose} closeDisabled={saving}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label className="field"><span>이름</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
        {!playerId && <label className="field"><span>초기 비밀번호</span><input type="text" autoComplete="off" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required /></label>}
        <div className="form-row"><label className="field"><span>성별</span><select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as Gender })}><option value="M">남</option><option value="F">여</option></select></label><label className="field"><span>부수</span><input type="number" min={-2} max={6} step={1} value={form.club_rank} onChange={(event) => setForm({ ...form, club_rank: event.target.value })} required /></label></div>
        <div className="toggle-row"><label><input type="checkbox" checked={form.is_freshman} onChange={(event) => setForm({ ...form, is_freshman: event.target.checked })} /><span>신입 부원</span></label></div>
        {error && <Notice>{error}</Notice>}
        <button className="primary-button primary-button--large" disabled={saving}>{saving ? "저장하는 중" : "저장하기"}</button>
      </form>
    </Modal>
  );
}

function PasswordResetModal({ player, onClose }: { player: UserRead; onClose: () => void }) {
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { const response = await apiRequest<{ message: string }>(`/admin/players/${player.id}/password-reset`, { method: "POST", body: jsonBody({ new_password: password }) }); setMessage(response.message); setPassword(""); } catch (caught) { setMessage(caught instanceof Error ? caught.message : "초기화하지 못했습니다."); } finally { setSaving(false); } };
  return <Modal title={`${player.username} 비밀번호 초기화`} description="기존 로그인 세션은 모두 종료돼요." onClose={onClose} closeDisabled={saving}><form className="modal-form" onSubmit={submit}><label className="field"><span>새 비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} disabled={saving} required /></label>{message && <Notice tone={message.includes("초기화했습니다") ? "success" : "error"}>{message}</Notice>}<button className="primary-button primary-button--large" disabled={saving}>{saving ? "초기화 중" : "비밀번호 초기화"}</button></form></Modal>;
}

function DeletePlayerModal({ player, onClose, onDeleted }: { player: UserRead; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    setError("");
    try {
      await apiRequest<void>(`/admin/players/${player.id}`, { method: "DELETE" });
      await onDeleted();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선수를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title={`${player.username} 삭제`} description="삭제한 선수 계정은 복구할 수 없어요." onClose={onClose} closeDisabled={deleting}>
      <div className="modal-form">
        <Notice tone="info">경기나 대회 기록이 없는 선수만 삭제할 수 있어요.</Notice>
        {error && <Notice>{error}</Notice>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={deleting}>취소</button>
          <button className="danger-button" type="button" onClick={() => void remove()} disabled={deleting}><Trash2 size={18} /> {deleting ? "삭제하는 중" : "삭제하기"}</button>
        </div>
      </div>
    </Modal>
  );
}
