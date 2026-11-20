import "server-only";
import { supportPhone, audience } from "../service-info";
export function operationsPolicy() {
  const operator = process.env.OPERATOR_NAME?.trim() || "";
  const contact = supportPhone;
  const targetAge = audience;
  const processing = process.env.DATA_PROCESSING_NOTICE?.trim() || "";
  const retention = process.env.SURVEY_RETENTION_NOTICE?.trim() || "";
  const logsConfirmed = process.env.HOST_LOG_POLICY_CONFIRMED === "true";
  return {
    operator,
    contact,
    targetAge,
    processing,
    ready: Boolean(operator && contact && targetAge && processing && retention && logsConfirmed),
  };
}
