import Chat from "@/components/chat/Chat";
import { configured, limits } from "@/lib/server/config";
import { surveyConfig } from "@/lib/server/survey";
import { operationsPolicy } from "@/lib/server/operations";
export const dynamic = "force-dynamic";
export default function Home() {
  const policy = operationsPolicy();
  return (
    <Chat
      config={{
        name: process.env.APP_NAME || "마음 한걸음",
        operator: policy.operator,
        contact: policy.contact,
        ready: configured(),
        maxInput: limits().input,
        development: !policy.ready,
        survey: surveyConfig(),
        policy: { targetAge: policy.targetAge, processing: policy.processing },
      }}
    />
  );
}
