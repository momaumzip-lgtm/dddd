import { Check } from "lucide-react";
import { useState } from "react";
import type { PublicConfig } from "@/lib/config";
import { supportLink } from "@/lib/service-info";

export default function PrivacyNotice({
  config,
  onConfirm,
  starting,
}: {
  config: PublicConfig;
  onConfirm: (rememberTab: boolean) => void;
  starting: boolean;
}) {
  const [rememberTab, setRememberTab] = useState(false);
  return (
    <>
      <h2 id="panel-title">대화 전에 잠깐 확인해 주세요</h2>
      <p>
        AI와 이야기하며 마음을 정리하는 공간이에요. 전문 상담이나 진료를 대신하지 않으며, 사람이
        실시간으로 대화를 확인하지 않아요.
      </p>
      <h3>입력한 내용은 AI에게 전달돼요</h3>
      <p>
        답변과 안전 확인을 위해 입력한 내용과 앞선 대화를 운영 서버와 OpenAI로 보내요. 이름, 연락처,
        자세한 주소는 빼고 이야기해 주세요.
      </p>
      <h3>남기고 싶은 문장은 먼저 복사해 주세요</h3>
      <p>
        서비스는 대화 원문·요약·기록을 별도로 저장하지 않아요. 아래 선택을 켜면 이 탭에서 대화와
        작성 중인 내용을 새로고침 후 불러올 수 있어요. 외부 서비스에는 보안 등을 위해 내용이 일정
        기간 남을 수 있어요.
      </p>
      <h3>설문은 원할 때만 참여해 주세요</h3>
      <p>
        동의하고 제출한 설문 답변과 접속 경로는 Netlify Forms에 저장하고 운영자 이메일로 보내요.
        채팅과 기록은 첨부하지 않고, 설문 답변은 OpenAI로 보내지 않아요.
      </p>
      <details className="survey-disclosure">
        <summary>데이터 전달·보관 자세히 보기</summary>
        <h3>대화와 이용 정보</h3>
        <p>
          대화 원문·요약·기록은 서비스 DB에 남기지 않아요. 탭에서 이어가기를 선택한 경우에만 이
          브라우저 탭에 최근 저장 시점부터 최대 2시간 보관해요. 새 대화에서는 이 탭의 이전 기록을
          지워요. 외부에 이미 전달된 내용은 별도의 기준에 따라 처리돼요.
        </p>
        <p>
          익명 세션 쿠키는 최대 2시간, 사용량 확인과 중복 요청 방지에 쓰는 기술 정보는 최대 25시간
          유효해요. 만료된 정보는 다음 요청 때 정리해요.
        </p>
        <h3>외부 서비스의 로그·백업과 설문 보관</h3>
        <p>{config.policy.processing || "운영자의 외부 서비스 처리·보관 기준을 확인 중이에요."}</p>
        <a
          href="https://developers.openai.com/api/docs/guides/your-data"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAI 데이터 처리 안내 ↗
        </a>
        <h3>운영 및 문의</h3>
        <p>
          운영주체: {config.operator || "운영 정보 확인 중"}
          <br />
          문의 및 삭제 요청: <a href={supportLink}>{config.contact}</a>
          <br />
          이용 대상: {config.policy.targetAge}
        </p>
      </details>
      <p className="fine-print">
        이 버튼은 안내를 확인하는 용도예요. 설문 참여와 제출 동의는 설문 화면에서 따로 선택해요.
      </p>
      {starting && (
        <label className="tab-remember">
          <input
            type="checkbox"
            checked={rememberTab}
            onChange={(event) => setRememberTab(event.target.checked)}
          />
          이 탭에서 새로고침 후 이어가기 (선택)
        </label>
      )}
      <button className="primary" onClick={() => onConfirm(rememberTab)}>
        <Check size={18} />
        {starting ? "확인하고 대화 시작하기" : "안내 닫기"}
      </button>
    </>
  );
}
