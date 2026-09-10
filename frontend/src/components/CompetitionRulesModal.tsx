import { Modal } from "./Modal";

export function CompetitionRulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="competition-rules-dialog">
      <Modal title="리그전 안내" description="진행 방식과 동률 처리 기준" onClose={onClose}>
        <div className="competition-rules-content" tabIndex={0} aria-label="리그전 진행 방식과 순위 안내">
          <section>
            <h3>개인 리그</h3>
            <p>한 조는 <strong>4~6명</strong>으로 구성하며, 모든 선수가 서로 한 번씩 경기합니다.</p>
            <p className="competition-rules-note">4인조는 6경기, 5인조는 10경기, 6인조는 15경기입니다.</p>
            <h4>순위는 다음 순서로 결정해요</h4>
            <ol>
              <li>전체 경기에서 거둔 <strong>승수</strong></li>
              <li>전체 승수가 같은 선수들끼리의 경기에서 거둔 <strong>승수</strong></li>
              <li>조 전체 경기의 <strong>세트 득실</strong> — 얻은 세트 수에서 잃은 세트 수를 뺀 값</li>
            </ol>
          </section>

          <section>
            <h3>단체전</h3>
            <p><strong>4인 팀</strong>들이 서로 한 번씩 대결합니다. 한 팀 대결은 <strong>4단식</strong>으로 진행하며, 각 선수는 단식에 한 번씩 출전합니다.</p>
            <p>승부가 먼저 정해져도 <strong>4단식 결과를 모두 입력</strong>해야 합니다. 단식이 <strong>2:2</strong>이면 각 팀에서 단식에 패한 2명이 복식으로 승부를 결정합니다.</p>
            <h4>팀 순위는 다음 순서로 결정해요</h4>
            <ol>
              <li>팀 대결에서 거둔 <strong>승수</strong></li>
              <li>전체 승수가 같은 팀들끼리의 대결에서 거둔 <strong>승수</strong></li>
              <li>완료된 팀 대결의 <strong>단식·복식 경기 득실</strong> — 이긴 경기 수에서 진 경기 수를 뺀 값</li>
            </ol>
            <p className="competition-rules-note">경기 득실은 세트 점수 합계가 아닙니다. 팀 순위에는 완료된 팀 대결만 반영합니다.</p>
          </section>

          <section>
            <h3>끝까지 동률이라면</h3>
            <p>마지막 기준까지 같으면 <strong>공동 순위</strong>입니다. 예를 들어 두 명이 공동 1위이면 다음 순위는 3위입니다. 이름순으로 표시되더라도 순위는 같습니다.</p>
            <p className="competition-rules-note">동률 비교는 전체 승수가 같은 선수·팀을 한 그룹으로 묶어 한 번만 합니다. 일부만 동률로 남아도 그들끼리 다시 비교하지 않습니다.</p>
          </section>

          <section>
            <h3>기록과 마감</h3>
            <ul>
              <li>개인 리그는 내 경기, 단체전은 내 팀의 경기 결과를 입력할 수 있습니다.</li>
              <li>단식·복식 점수는 <strong>3:0 또는 2:1</strong>로 기록합니다. 패배한 쪽은 반대로 입력합니다.</li>
              <li>같은 상대와의 단식은 일반 경기와 다른 대회를 합쳐 <strong>한국 날짜 기준 하루 한 번</strong>만 기록할 수 있습니다.</li>
              <li>단식은 개인 경기 기록·랭킹·정산에 포함됩니다. 복식은 개인 통계에 포함되지 않습니다.</li>
              <li>모든 대진의 결과가 입력되면 자동으로 <strong>완료</strong> 상태가 됩니다. 완료된 다음 날 <strong>0시(한국 시간)</strong>에 자동으로 <strong>종료</strong>됩니다.</li>
              <li>관리자는 완료된 대회를 바로 종료하거나, 완료·종료 후에도 결과를 정정할 수 있습니다. 결과 삭제나 정정으로 미완료 대진이 생기면 다시 <strong>진행 중</strong> 상태가 됩니다.</li>
            </ul>
          </section>
        </div>
      </Modal>
    </div>
  );
}
