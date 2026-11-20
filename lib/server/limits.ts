import { AppError } from "./errors";
export interface Store {
  eval(script: string, keys: string[], args: string[]): Promise<number>;
}
// All admission decisions and mutations execute in ONE Redis EVAL. No conversation content is stored.
export const ADMIT = `
if redis.call('EXISTS',KEYS[1])==1 then return 2 end
if redis.call('EXISTS',KEYS[2])==1 then return 3 end
local revision=tonumber(redis.call('GET',KEYS[6]) or '0')
if revision~=tonumber(ARGV[4]) then return 4 end
for i=3,5 do if tonumber(redis.call('GET',KEYS[i]) or '0')>=tonumber(ARGV[i-2]) then return 1 end end
redis.call('SET',KEYS[1],ARGV[5],'EX',86400)
redis.call('SET',KEYS[2],ARGV[5],'EX',180)
for i=3,5 do redis.call('INCR',KEYS[i]); redis.call('EXPIRE',KEYS[i],i==3 and 65 or 90000) end
return 0`;
export const EXTRA = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 3 end
if tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[2]) then return 1 end
redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],90000); return 0`;
export const FINISH = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 3 end
if ARGV[2]~='' then redis.call('SET',KEYS[2],ARGV[2],'EX',86400) end
redis.call('DEL',KEYS[1]);return 0`;
export class RedisStore implements Store {
  async eval(script: string, keys: string[], args: string[]) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)
      throw new AppError(503, "STORE", "사용량 확인을 준비 중이에요. 잠시 후 다시 시도해 주세요.");
    try {
      const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["EVAL", script, keys.length, ...keys, ...args]),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      const data = (await response.json()) as { error?: unknown; result?: unknown };
      if (!response.ok || data.error || typeof data.result !== "number") throw new Error();
      return data.result;
    } catch {
      throw new AppError(
        503,
        "STORE",
        "사용량을 확인하지 못했어요. 입력은 보존돼요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
}
type Cap = { minute: number; day: number; global: number };
export class Gate {
  constructor(
    private store: Store,
    private cap: Cap,
    private clock = () => Date.now(),
  ) {}
  keys(sid: string, cid: string, rid: string) {
    const now = this.clock();
    const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
    const root = "{maeum}:";
    return [
      `${root}req:${sid}:${rid}`,
      `${root}lock:${sid}:${cid}`,
      `${root}minute:${sid}:${Math.floor(now / 60000)}`,
      `${root}day:${sid}:${day}`,
      `${root}global:${day}`,
      `${root}head:${sid}:${cid}`,
    ];
  }
  async enter(sid: string, cid: string, rid: string, revision: number) {
    const keys = this.keys(sid, cid, rid);
    this.check(
      await this.store.eval(ADMIT, keys, [
        String(this.cap.minute),
        String(this.cap.day),
        String(this.cap.global),
        String(revision),
        rid,
      ]),
    );
    return {
      extra: async () =>
        this.check(
          await this.store.eval(EXTRA, [keys[1], keys[4]], [rid, String(this.cap.global)]),
        ),
      finish: async (next?: number) =>
        this.check(
          await this.store.eval(
            FINISH,
            [keys[1], keys[5]],
            [rid, next === undefined ? "" : String(next)],
          ),
        ),
    };
  }
  check(code: number) {
    if (code === 1)
      throw new AppError(
        429,
        "LIMIT",
        "이용 가능한 횟수에 도달했어요. 잠시 쉬었다가 다시 이용해 주세요.",
      );
    if (code === 2)
      throw new AppError(
        409,
        "DUPLICATE",
        "이미 접수한 요청이에요. 연결이 끊겼다면 새 답변을 요청해 주세요.",
      );
    if (code === 3)
      throw new AppError(409, "BUSY", "이전 답변을 처리 중이에요. 잠시 후 다시 시도해 주세요.");
    if (code === 4)
      throw new AppError(409, "STALE", "대화 상태가 달라졌어요. 새 대화를 시작해 주세요.");
  }
}
