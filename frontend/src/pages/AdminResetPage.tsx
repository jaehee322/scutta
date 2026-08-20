import { ArrowLeft, DatabaseZap, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { Notice } from "../components/Notice";
import { PageLoader } from "../components/Loading";
import type { DatabaseResetPreview, DatabaseResetResponse } from "../types";

export function AdminResetPage() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<DatabaseResetPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<DatabaseResetPreview>("/admin/database/reset-preview")
      .then(setPreview)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "초기화 정보를 불러오지 못했습니다."),
      );
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await apiRequest<DatabaseResetResponse>("/admin/database/reset", {
        method: "POST",
        body: jsonBody({ confirmation, admin_password: password }),
      });
      window.alert(`${result.deleted.players}명의 선수, ${result.deleted.competitions}개의 대회와 ${result.deleted.matches}개의 경기를 삭제했습니다.`);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "초기화하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!preview && !error) return <PageLoader />;

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 홈
      </Link>
      <header className="admin-page-heading">
        <div><h1>학기 데이터 초기화</h1></div>
      </header>

      {error && <Notice>{error}</Notice>}

      {preview && (
        <>
          <section className="reset-warning">
            <ShieldAlert size={28} />
            <div>
              <strong>이 작업은 되돌릴 수 없어요</strong>
              <p>관리자 계정과 관리자 로그인 세션, 상품 설정은 유지됩니다.</p>
            </div>
          </section>

          <section className="reset-counts">
            <div><span>경기</span><strong>{preview.matches}</strong></div>
            <div><span>선수</span><strong>{preview.players}</strong></div>
            <div><span>대회</span><strong>{preview.competitions}</strong></div>
            <div><span>선수 세션</span><strong>{preview.player_sessions}</strong></div>
          </section>

          <form className="reset-form card" onSubmit={submit}>
            <div className="section-heading">
              <div className="section-icon section-icon--red"><DatabaseZap size={22} /></div>
              <div><h2>최종 확인</h2></div>
            </div>
            <label className="field">
              <span>아래 문구를 그대로 입력하세요</span>
              <code>{preview.confirmation_required}</code>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            </label>
            <label className="field">
              <span>현재 관리자 비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={4}
                required
              />
            </label>
            <button
              className="danger-button danger-button--large"
              disabled={submitting || confirmation !== preview.confirmation_required}
            >
              {submitting ? "초기화하는 중" : "모든 선수·대회·경기 데이터 삭제"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
