// Operational gate only. API credentials are deliberately outside this release check's scope.
const required = [
  "OPERATOR_NAME",
  "SUPPORT_CONTACT",
  "TARGET_AGE_NOTICE",
  "DATA_PROCESSING_NOTICE",
  "SURVEY_RETENTION_NOTICE",
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (process.env.HOST_LOG_POLICY_CONFIRMED !== "true")
  missing.push("HOST_LOG_POLICY_CONFIRMED=true");
console.log(
  JSON.stringify(
    {
      scope: "non-API operational release readiness",
      ready: missing.length === 0,
      missing,
      additionalChecks: [
        "공개 접근 설정 및 무로그인 HTTPS 검수",
        "iOS/Android 실기기 키보드·IME 검수",
      ],
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
