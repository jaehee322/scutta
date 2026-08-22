import { type FormEvent, useState } from "react";

import { apiRequest, jsonBody } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "./Modal";
import { Notice } from "./Notice";
import { PwaInstallButton } from "./PwaManager";

export function AccountSettings() {
  const { logout } = useAuth();
  const [actionError, setActionError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    setActionError("");
    try {
      await logout();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "로그아웃하지 못했습니다.");
    }
  };

  return (
    <>
      {actionError && <Notice>{actionError}</Notice>}

      <section className="settings-list" aria-label="계정 설정">
        <PwaInstallButton className="settings-list__install" />
        <button type="button" onClick={() => setPasswordOpen(true)}>
          <div><strong>비밀번호 변경</strong></div>
          <span className="settings-list__action">변경</span>
        </button>
        <button type="button" className="is-danger" onClick={() => void handleLogout()}>
          <div><strong>로그아웃</strong></div>
          <span className="settings-list__action">나가기</span>
        </button>
      </section>

      {passwordOpen && (
        <Modal
          title="비밀번호 변경"
          description="새 비밀번호는 8자 이상 입력해 주세요."
          onClose={() => setPasswordOpen(false)}
          closeDisabled={submitting}
        >
          <form className="modal-form" onSubmit={handlePassword}>
            <label className="field">
              <span>현재 비밀번호</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                minLength={4}
                maxLength={128}
                autoComplete="current-password"
                disabled={submitting}
                required
              />
            </label>
            <label className="field">
              <span>새 비밀번호</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                disabled={submitting}
                required
              />
            </label>
            {message && (
              <Notice tone={message.includes("변경했습니다") ? "success" : "error"}>
                {message}
              </Notice>
            )}
            <button
              type="submit"
              className="primary-button primary-button--large"
              disabled={submitting}
            >
              {submitting ? "변경하는 중" : "변경하기"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
