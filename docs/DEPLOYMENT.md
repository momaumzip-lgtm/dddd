# 배포 및 환경변수

## Netlify 배포

1. `momaumzip-lgtm/dddd` 저장소의 `main` 브랜치를 연결합니다.
2. 기본 디렉터리는 저장소 루트, 빌드 명령은 `npm run build`, 배포 디렉터리는 `.next`입니다. Node.js 22를 사용합니다.
3. Project configuration의 Environment variables에서 아래 값을 등록합니다. API 비밀 값은 Functions에서 사용할 수 있어야 합니다.
4. 환경변수를 변경한 뒤 새 배포를 실행합니다. 기존 배포에는 변경 값이 바로 적용되지 않습니다.

Netlify가 Next.js 어댑터를 자동 적용합니다. 정적 HTML 내보내기나 SPA 전체 경로 리다이렉트를 추가하지 않습니다. API와 페이지 렌더링은 서버 함수로 실행됩니다. 함수의 60초 제한을 고려해 AI 작업 전체는 45초, 개별 호출은 본문 수신·파싱을 포함해 12초로 제한합니다.

## 필수 설정

최종 도메인은 `momaumzip.com`입니다. `www.momaumzip.com`은 기본 도메인으로 이동하도록 연결합니다. `netlify.toml`의 보안 검사 예외 목록은 화면·소스에 공개되는 운영 설정만 포함합니다. API 키, 세션 서명 키, Redis·이메일 인증 토큰은 예외에 포함하지 않습니다.

| 변수                        | 값 또는 입력 기준                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_NAME`                  | 마음 한걸음                                                                                |
| `APP_URL`                   | `https://momaumzip.com`                                                                    |
| `ALLOWED_ORIGIN`            | `https://momaumzip.com`                                                                    |
| `SESSION_SECRET`            | 독립적으로 생성한 32자 이상의 난수. 서버 비밀 값                                           |
| `OPENAI_API_KEY`            | 운영자가 직접 등록하는 기존 OpenAI API 키. 서버 비밀 값                                    |
| `OPENAI_MODEL`              | `gpt-5-nano`                                                                               |
| `UPSTASH_REDIS_REST_URL`    | Upstash Redis의 REST URL                                                                   |
| `UPSTASH_REDIS_REST_TOKEN`  | 같은 Redis의 REST token. 서버 비밀 값                                                      |
| `OPERATOR_NAME`             | maumzip                                                                                    |
| `SUPPORT_CONTACT`           | 010-6675-9496                                                                              |
| `TARGET_AGE_NOTICE`         | 20~40대 중심                                                                               |
| `DATA_PROCESSING_NOTICE`    | 실제 외부 처리·보관 조건을 확인한 안내                                                     |
| `HOST_LOG_POLICY_CONFIRMED` | 호스팅·APM 본문 로그 및 보존 설정 확인 후 `true`                                           |
| `SURVEY_RETENTION_NOTICE`   | 운영자 메일함 설문 응답은 접수일부터 1년 보관 후 삭제. 발송 서비스의 보존 조건은 별도 확인 |

실제 계정이나 계약 조건을 확인하지 않은 정책 값은 임의로 확정하지 않습니다. 운영 준비 확인은 `npm run release:check`로 실행합니다. 이 명령은 API 키의 유효성을 검증하지 않습니다.

## 선택 설문 이메일

| 변수                | 입력 기준                               |
| ------------------- | --------------------------------------- |
| `RESEND_API_KEY`    | Resend API 키. 서버 비밀 값             |
| `SURVEY_FROM_EMAIL` | Resend에서 발신이 검증된 이메일         |
| `SURVEY_TO_EMAIL`   | 설문 응답을 개별 전달받을 운영자 이메일 |

설문 이메일 설정이 없으면 제출을 비활성화하고 전송 준비 중임을 안내합니다. 수신 주소를 이용자 입력으로 받지 않습니다. 설문 원문은 앱 DB에 저장하지 않으며 채팅·일기·요약을 첨부하지 않습니다. 메일함 자동 삭제 기능은 없으므로 운영자가 1년 보관·삭제 기준을 관리합니다.

## 비용 및 한도

현재 설정은 최저가 요청에 따라 `gpt-5-nano`입니다. 2026-11-20 확인 기준 100만 토큰당 입력 $0.05, 출력 $0.40입니다. **2026-12-11 종료 예정**이므로 그 전에 운영자가 대체 모델을 결정하고 검수해야 합니다. 상위 모델로 자동 전환하지 않습니다. Standard 처리, `reasoning.effort: minimal`, SDK 자동 재시도 0회로 설정했습니다.

일반 정상 대화는 분류·생성·검수의 유료 호출 3회와 무료 moderation 2회를 거칩니다. 비용은 이력·시스템 지시·검수·reasoning 토큰을 포함한 합계입니다. 설정 가능한 한도는 `.env.example`에 있으며, 실제 사용량 집계에는 대화 원문을 기록하지 않습니다.

공식 참고: [Netlify Next.js](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [함수 실행 제한](https://docs.netlify.com/build/functions/configuration/), [모델 정보](https://developers.openai.com/api/docs/models/gpt-5-nano), [모델 종료 일정](https://developers.openai.com/api/docs/deprecations).
