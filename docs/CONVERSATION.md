# 짧은 마음 대화

초기 감정 선택은 대화 턴에 포함하지 않습니다. `lib/emotions.ts`의 명시적 ID 125개(긍정 57, 부정 68)와 범주형 강도를 화면·검색·서버가 공유합니다. 검색 별칭과 공백 없는 표기를 지원하며, 모르는 감정·강도는 미정입니다. 다른 감정을 고르면 강도를 새로 고르고, 정정 발화가 선택보다 우선합니다.

현재 UI는 `Accept: application/x-ndjson`로 `/api/chat`에 실제 대화 전체, 최신 메시지 한 개, 감정·강도·선택 버전, 사용자 메시지 ID, 요청 ID와 서명 토큰을 전달합니다. SDK 7.59의 Responses 스트림 파서가 상류 SSE를 읽고, 완결된 JSON 문자열 원소만 문장 단위로 추출합니다. 미완성 JSON 전체를 반복 파싱하지 않습니다. 완결된 문장은 누적 출력 moderation을 거쳐 바로 표시하며 가짜 타자 효과는 없습니다.

일반 경로는 입력 moderation → 생성 LLM 1회 → 문장별 누적 출력 moderation입니다. 입력이 flagged이거나 기존 안전 확인이 해결되지 않았다면 별도 맥락 분류를 유지합니다. 고확신 현재 응급 상황은 고정 안전 안내를 우선합니다. 정상이 아닌 안전 상태에는 일반 완료 카운터를 적용하지 않습니다. 감정 강도만으로 위험을 판정하지 않습니다. 새 스트리밍 경로에는 매 턴 별도 LLM 평가·요약·형식 재생성을 추가하지 않습니다. 기존 JSON 경로는 배포 전 열린 클라이언트와의 호환을 위해 남아 있습니다.

서버가 서명한 진행 정보로 질문 수·일반 턴 수·완료·반영된 메시지 ID를 관리합니다. 세 번째 일반 응답은 질문 없는 정리입니다. 충분한 정보, 명시적 종료, 모르겠음, 질문·조언 거절은 더 일찍 마칠 수 있습니다. 계속 이야기하기는 완료된 서명 상태에서만 새 구간을 시작하고 대화와 감정은 유지합니다.

`response.completed`와 최종 스키마, 화면에 보낸 본문이 모두 일치해야 성공으로 확정합니다. failed/error/incomplete/refusal 또는 완료 이벤트 없는 종료는 실패입니다. 표시된 일부 문장은 중단 상태로 남고 기존 대화와 입력을 지우지 않습니다. 새 네트워크 요청 ID로 명시적으로 재시도하되 사용자 메시지 ID는 유지합니다. SDK 자동 재시도는 0회, 호출별 12초·전체 45초입니다.

클라이언트 세대 번호·요청 ID·대화 ID와 선택 버전으로 오래된 응답의 덮어쓰기를 막습니다. 감정 변경은 진행 중 응답을 바꾸지 않고 다음 요청부터 적용됩니다. 서명 토큰과 서버 revision 커밋 후 최종 패킷 자체가 유실되는 극히 짧은 구간은 원문을 서버에 저장하지 않는 현재 구조에서 완전 재전송할 수 없습니다. 이 경우에도 입력·화면을 자동 삭제하지 않으며 상태 오류를 알립니다.

로그는 요청 ID·모델·시간·토큰·오류 코드만 기록합니다. 실제 입력·답변·감정 선택은 로그나 분석 도구에 보내지 않습니다. 브라우저 performance mark도 요청별 시간만 담습니다. HTTP 접수·서버 시간·첫 문장·브라우저 첫 표시·전체 완료를 구별하며, 소표본을 안정적인 운영 p95로 해석하지 않습니다.

참고: [응답 지연](https://developers.openai.com/api/docs/guides/latency-optimization), [대화 상태](https://developers.openai.com/api/docs/guides/conversation-state), [스트리밍](https://developers.openai.com/api/docs/guides/streaming-responses), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [오류](https://developers.openai.com/api/docs/guides/error-codes).
