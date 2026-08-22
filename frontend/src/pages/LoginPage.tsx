import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Notice } from "../components/Notice";
import { PwaInstallButton } from "../components/PwaManager";

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
      <section className="login-panel">
        <div className="login-panel__inner">
          <h1>로그인</h1>
          <p className="login-panel__lead">이름과 비밀번호를 입력하세요.</p>

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
                  placeholder="비밀번호를 입력하세요"
                  minLength={4}
                  maxLength={128}
                  required
                />
              </div>
            </label>

            {error && <Notice>{error}</Notice>}

            <button className="primary-button primary-button--large" disabled={submitting}>
              <span>{submitting ? "로그인 중" : "로그인"}</span>
              {!submitting && <ArrowRight size={20} />}
            </button>
          </form>

          <PwaInstallButton className="login-install-button" />

          <p className="login-help">비밀번호를 잊었다면 동아리 관리자에게 문의해 주세요.</p>
        </div>
      </section>
    </main>
  );
}
