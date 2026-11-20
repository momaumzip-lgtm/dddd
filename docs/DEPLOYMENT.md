# 배포 및 환경변수

## Netlify 배포

1. `momaumzip-lgtm/dddd` 저장소의 `main` 브랜치를 연결합니다.
2. 기본 디렉터리는 저장소 루트, 빌드 명령은 `npm run build`, 배포 디렉터리는 `.next`입니다. Node.js 22를 사용합니다.
3. Project configuration의 Environment variables에서 아래 값을 등록합니다. API 비밀 값은 Functions에서 사용할 수 있어야 합니다.
4. 환경변수를 변경한 뒤 새 배포를 실행합니다. 기존 배포에는 변경 값이 바로 적용되지 않습니다.

Netlify가 Next.js 어댑터를 자동 적용합니다. 정적 HTML 내보내기나 SPA 전체 경로 리다이렉트를 추가하지 않습니다. API와 페이지 렌더링은 서버 함수로 실행됩니다. 함수의 60초 제한을 고려해 AI 작업 전체는 45초, 개별 호출은 본문 수신·파싱을 포함해 12초로 제한합니다.

## 필수 설정

최종 도메인은 `momaumzip.com`입니다. `www.momaumzip.com`은 기본 도메인으로 이동하도록 연결합니다. `netlify.toml`의 보안 검사 예외 목록은 화면·소스에 공개되는 운영 설정만 포함합니다. API 키, 세션 서명 키, DB 연결 문자열은 예외에 포함하지 않습니다.

| 변수                        | 값 또는 입력 기준                                                      |
| --------------------------- | ---------------------------------------------------------------------- |
| `APP_NAME`                  | 마음 한걸음                                                            |
| `APP_URL`                   | `https://momaumzip.com`                                                |
| `ALLOWED_ORIGIN`            | `https://momaumzip.com`                                                |
| `SESSION_SECRET`            | 독립적으로 생성한 32자 이상의 난수. 서버 비밀 값                       |
| `OPENAI_API_KEY`            | 운영자가 직접 등록하는 기존 OpenAI API 키. 서버 비밀 값                |
| `OPENAI_MODEL`              | `gpt-6-luna`                                                           |
| `OPERATOR_NAME`             | maumzip                                                                |
| `DATA_PROCESSING_NOTICE`    | 실제 외부 처리·보관 조건을 확인한 안내                                 |
| `HOST_LOG_POLICY_CONFIRMED` | 호스팅·APM 본문 로그 및 보존 설정 확인 후 `true`                       |
| `SURVEY_RETENTION_NOTICE`   | Netlify Forms와 운영자 메일함에서 접수일부터 1년 보관 후 운영자가 삭제 |

실제 계정이나 계약 조건을 확인하지 않은 정책 값은 임의로 확정하지 않습니다. 운영 준비 확인은 `npm run release:check`로 실행합니다. 이 명령은 API 키의 유효성을 검증하지 않습니다.

## 내장 DB

`@netlify/database`가 설치되어 있어 Netlify가 배포 시 DB와 `NETLIFY_DB_URL`을 자동으로 준비합니다. 별도 Upstash 가입이나 Redis 토큰이 필요하지 않습니다. `netlify/database/migrations/`의 SQL이 게시 전에 적용되며, 실패하면 새 배포가 게시되지 않습니다.

사용량·요청 식별자·revision만 저장합니다. 모든 판정은 기존 mutex 행 잠금을 잡은 단일 Postgres 트랜잭션에서 처리하며 AI·설문 접수 요청 중에는 잠금을 유지하지 않습니다. DB 장애·5초 내 확인 실패 시 과금 호출을 진행하지 않습니다. 만료값은 다음 요청에서 정리하고, DB 백업 보관 기간은 별도입니다.

DB는 기존 Netlify 무료 플랜 크레딧을 사용합니다. 현재 공식 기준 compute는 시간당 단위 10크레딧, 대역폭은 GB당 20크레딧입니다. 무료 플랜은 비활성 5분 후 절전합니다. 사용량이 많으면 무료 크레딧이 먼저 소진될 수 있으므로 대시보드를 확인합니다. 이 프로젝트 설정에서 유료 플랜이나 자동 충전을 활성화하지 않았습니다. [Netlify DB 요금·제한](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/)

## 선택 설문: Netlify Forms

외부 이메일 발송 서비스와 추가 API 키는 사용하지 않습니다.

1. Netlify의 **Forms → Settings → Find forms on your pages**를 켭니다.
2. 배포 시 `public/netlify-forms.html`의 `maumzip-experience` 폼이 감지되는지 확인합니다. Next.js 서버 렌더링과 별개인 정적 HTML 스키마가 필요합니다.
3. **Forms → Notifications**에서 Email 알림을 `momaum.zip@gmail.com`으로 설정합니다. 폼이 감지되면 대상도 `maumzip-experience`로 지정합니다. 계정 소속 이메일이면 별도 발신 도메인 인증이 필요하지 않습니다.
4. `NETLIFY_FORMS_ENABLED=true`와 처리·보관 안내를 설정하고 재배포합니다. 알림 설정과 수신 주소는 Netlify 대시보드에서 관리하며 앱 환경변수에 이메일 키를 넣지 않습니다.
5. 운영 데이터와 분리된 검증용 Forms에서 온라인·QR 응답을 제출해 Netlify 저장과 이메일 수신을 각각 확인합니다. 스팸으로 분류된 항목은 일반 알림 대상에서 빠질 수 있으므로 스팸 목록도 확인합니다.

접속 경로, 직접 답한 문항, 제출 동의·버전·무작위 접수번호만 Forms로 전달합니다. 채팅·일기·요약·세션 쿠키·서명 토큰은 첨부하지 않습니다. UI 제출은 `/api/survey`에서 서명·Origin·크기·문항·공유 한도를 확인하고 URL 인코딩하여 고정된 운영 도메인의 Forms 엔드포인트로 보냅니다.

Forms는 공개 접수 기능이므로 직접 POST에는 앱 API의 서명·한도가 적용되지 않습니다. Netlify 스팸 필터와 honeypot을 함께 사용하며, 이를 인증된 설문 통계로 간주하지 않습니다. Forms에는 공급자 중복 방지 API가 없어 앱 DB가 대화당 외부 전송 시도 한 번만 허용합니다. 응답이 유실돼도 자동·수동 재전송을 하지 않습니다. 같은 요청의 재확인은 앱 DB의 접수 상태만 읽으며, 불확실한 경우 운영자가 접수번호로 Forms를 확인합니다.

설문은 Netlify Forms와 운영자 메일함에 저장됩니다. 운영자가 매월 접수일이 1년 지난 항목을 두 곳에서 삭제하고, 별도 CSV를 내려받았다면 그 사본도 관리해야 합니다. 자동 삭제는 구현하지 않았습니다. 스팸 방지 기술 정보와 백업은 Netlify의 별도 처리 조건을 따릅니다.

공식 문서: [폼 설정](https://docs.netlify.com/manage/forms/setup/), [이메일 알림](https://docs.netlify.com/manage/forms/notifications/), [접수·삭제 관리](https://docs.netlify.com/manage/forms/submissions/).

## 비용 및 한도

현재 운영 모델은 `gpt-6-luna`, Standard 처리, `reasoning.effort: none`, SDK 자동 재시도 0회입니다. 2026-11-21 확인 모델 문서 기준 100만 토큰당 입력 $0.10, 출력 $0.50입니다. gpt-5-nano minimal·low와 gpt-5.4-nano를 합성 사례로 비교했으며, 저렴해도 정리 모드에서 질문하거나 정정을 놓친 구성은 채택하지 않았습니다. 실제 계정에서 검수한 후보 중 품질 기준을 통과한 저비용 구성을 선택했습니다. 더 비싼 모델로 자동 전환하지 않습니다.

현재 UI의 스트리밍 일반 대화는 입력 moderation, 유료 생성 1회, 문장별 누적 출력 moderation을 거칩니다. 입력이 flagged이거나 안전 확인 상태이면 별도 맥락 분류가 추가될 수 있습니다. 과거 배포에서 열린 클라이언트의 JSON 호환 경로는 이전 분류·생성·검수 경로를 유지합니다. 실제 비용은 토큰 합계에 따라 달라지므로 호출 수 감소를 고정된 비용 절감률로 해석하지 않습니다. 응답 길이는 목표로 유도하며, 길이 때문에 재생성하지 않습니다. 12초 호출·45초 전체 예산과 기존 공유 한도를 유지합니다. 자세한 흐름은 `docs/CONVERSATION.md`에 있습니다.

공식 참고: [Netlify Next.js](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [함수 실행 제한](https://docs.netlify.com/build/functions/configuration/), [모델 정보](https://developers.openai.com/api/docs/models/gpt-6-luna), [모델 종료 일정](https://developers.openai.com/api/docs/deprecations).

공개 이용 대상과 문의 및 삭제 요청 전화번호는 `lib/service-info.ts`에서 관리합니다. 이전 배포의 연락처·연령 환경변수는 읽지 않습니다.

설문 v2는 기존 `maumzip-experience`의 알림 연결을 사용합니다. Netlify Forms에서 `submissionId`로 접수를 찾습니다. `surveyVersion`으로 이전 응답과 구별합니다. 숫자·null을 보존한 전체 응답은 `answers` JSON에 있고, 응답한 문항은 같은 이름의 필드에서도 확인할 수 있습니다. 접속 경로만 필수이며 온라인 선택 시 QR 항목, 불편 경험을 선택하지 않으면 상세 의견을 비웁니다. 한 접수번호로 다른 답을 보낼 수 없습니다.
