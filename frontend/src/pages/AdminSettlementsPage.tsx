import { ArrowLeft, Gift, RefreshCw, Save } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest, jsonBody } from "../api/client";
import { PageLoader } from "../components/Loading";
import { Notice } from "../components/Notice";
import type { SettlementCategoryKey, SettlementSettings } from "../types";

const prizeFields = [
  { category: "matches", label: "경기 수 부문" },
  { category: "wins", label: "승리 수 부문" },
  { category: "losses", label: "패배 수 부문" },
] as const satisfies readonly { category: SettlementCategoryKey; label: string }[];

export function AdminSettlementsPage() {
  const [settings, setSettings] = useState<SettlementSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await apiRequest<SettlementSettings>("/admin/settlements/settings");
      setSettings(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정산 설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;

    const prizes: SettlementSettings["prizes"] = {
      matches: settings.prizes.matches.trim(),
      wins: settings.prizes.wins.trim(),
      losses: settings.prizes.losses.trim(),
    };
    if (Object.values(prizes).some((prize) => !prize)) {
      setError("모든 부문의 상품을 입력해 주세요.");
      setSuccess("");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await apiRequest<SettlementSettings>("/admin/settlements/settings", {
        method: "PATCH",
        body: jsonBody({ prizes }),
      });
      setSettings(updated);
      setSuccess("정산 설정을 저장했습니다. 선수 정산 화면에 바로 반영됩니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정산 설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <ArrowLeft size={18} /> 홈
      </Link>
      <header className="admin-page-heading">
        <div>
          <h1>정산 설정</h1>
          <p>선수 정산 화면에 표시할 부문별 상품을 관리합니다.</p>
        </div>
      </header>

      {error && <Notice>{error}</Notice>}
      {!settings && (
        <button className="secondary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={17} /> 다시 불러오기
        </button>
      )}

      {settings && (
        <form className="settlement-settings-form" onSubmit={submit}>
          <section className="settlement-settings-card card">
            <div className="section-heading">
              <span className="section-icon section-icon--blue"><Gift size={22} /></span>
              <div><h2>부문별 상품</h2></div>
            </div>
            <div className="settlement-prize-fields">
              {prizeFields.map(({ category, label }) => (
                <label className="field" key={category}>
                  <span>{label}</span>
                  <input
                    value={settings.prizes[category]}
                    maxLength={200}
                    onChange={(event) => {
                      setSettings({
                        ...settings,
                        prizes: { ...settings.prizes, [category]: event.target.value },
                      });
                      setSuccess("");
                    }}
                    required
                  />
                </label>
              ))}
            </div>
          </section>

          {success && <Notice tone="success">{success}</Notice>}
          <button className="primary-button primary-button--large" disabled={saving}>
            <Save size={18} /> {saving ? "저장하는 중" : "변경사항 저장"}
          </button>
        </form>
      )}
    </div>
  );
}
