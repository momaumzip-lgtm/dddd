# 마음 한걸음

maumzip이 운영하는 한국어 AI 마음 정리 서비스입니다. 대화로 감정과 생각을 돌아보고, 오늘의 깨달음을 정리하거나 선택 설문으로 이용 경험을 남길 수 있습니다.

## 개발

Node.js 22.13 이상을 사용합니다.

```sh
npm ci
# .env.example을 .env.local로 복사하고 필요한 값을 설정합니다.
npm run dev
```

```sh
npm test
npm run typecheck
npm run format:check
npm run build
```

## 구조

- `app/`: 화면 진입점과 API 경로
- `components/chat/`: 대화·일기·설문 화면 및 브랜드 그래픽
- `lib/server/`: OpenAI 호출, 안전 검수, 세션 서명, 공유 한도, 이메일 전달
- `lib/browser/`: 페이지 이탈·복원 시 입력 초기화
- `tests/`: 서버·안전·세션·설문·SDK 회귀 검사
- `docs/`: 배포, 환경변수, 인수인계, 검수 안내

## 배포와 운영

Netlify는 `netlify.toml`을 읽고 표준 Next.js 빌드를 실행합니다. 서버 경로를 포함하므로 정적 폴더 업로드 방식으로 배포하지 않습니다.

- [배포 및 환경변수](docs/DEPLOYMENT.md)
- [운영·인수인계](docs/HANDOVER.md)
- [검수 기준](docs/QA.md)

API 키 등 비밀 값은 Netlify의 환경변수에 저장합니다. `.env.local`과 비밀 값은 저장소에 올리지 않습니다. 대화와 일기는 현재 화면 메모리에만 유지하며 앱 DB나 브라우저 영구 저장소에 저장하지 않습니다. 외부 AI·호스팅·이메일 서비스의 처리·보존 조건은 별도입니다.

AI 대화는 진단·치료·전문 상담을 제공하지 않으며 사람이 실시간으로 모니터링하지 않습니다.
