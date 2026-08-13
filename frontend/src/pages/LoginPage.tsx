import { ArrowRight, LockKeyhole, Trophy, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { Notice } from "../components/Notice";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 429 && caught.retryAfter) {
        setError(`${caught.retryAfter}초 후에 다시 시도해 주세요.`);
      } else {
        setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-hero" aria-label="SCUTTA 소개">
        <Brand />
        <div className="login-hero__copy">
          <span className="eyebrow eyebrow--light">SCUTTA TABLE TENNIS</span>
          <h1>
            오늘의 한 게임이
            <br />
            우리 동아리의 기록이 돼요
          </h1>
          <p>경기를 남기고, 함께 만든 랭킹과 추첨권을 확인하세요.</p>
        </div>
        <div className="login-hero__orb login-hero__orb--one" />
        <div className="login-hero__orb login-hero__orb--two" />
        <Trophy className="login-hero__trophy" size={108} strokeWidth={1.25} />
      </section>

      <section className="login-panel">
        <div className="login-panel__inner">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="eyebrow">다시 만나서 반가워요</span>
          <h2>SCUTTA에 로그인</h2>
          <p className="login-panel__lead">관리자가 등록한 이름과 학번을 입력해 주세요.</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>이름</span>
              <div className="input-shell">
                <UserRound size={20} aria-hidden="true" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="이름을 입력하세요"
                  maxLength={64}
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>비밀번호</span>
              <div className="input-shell">
                <LockKeyhole size={20} aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="학번 또는 변경한 비밀번호"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>
            </label>

            {error && <Notice>{error}</Notice>}

            <button className="primary-button primary-button--large" disabled={submitting}>
              <span>{submitting ? "확인하고 있어요" : "로그인"}</span>
              {!submitting && <ArrowRight size={20} />}
            </button>
          </form>

          <p className="login-help">비밀번호를 잊었다면 동아리 관리자에게 문의해 주세요.</p>
        </div>
      </section>
    </main>
  );
}
