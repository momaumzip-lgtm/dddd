import { AppError } from "./errors";
export interface Store {
  eval(script: string, keys: string[], args: string[]): Promise<number>;
}
// Admission, counters and revisions commit together in one database transaction.
export const ADMIT = "admit";
export const EXTRA = "extra";
export const FINISH = "finish";
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
  receiptKeys(sid: string, cid: string, rid: string) {
    return [
      `{maeum}:reply:${sid}:${cid}:${rid}`,
      `{maeum}:head:${sid}:${cid}`,
      `{maeum}:receipt:${sid}:${cid}`,
    ];
  }
  async acknowledge(sid: string, cid: string, rid: string, revision: number) {
    this.check(
      await this.store.eval("ack_reply", this.receiptKeys(sid, cid, rid), [rid, String(revision)]),
    );
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
    return this.receipt(keys, sid, cid, rid, this.cap.global);
  }
  async enterGuided(sid: string, cid: string, rid: string, revision: number, record: boolean) {
    const keys = this.keys(sid, cid, rid);
    const admission = await this.store.eval(
      "guided_admit",
      [
        keys[0],
        keys[1],
        keys[5],
        `{maeum}:guided:session:${sid}:${cid}`,
        keys[2].replace(":minute:", ":guided:minute:"),
        keys[3].replace(":day:", ":guided:day:"),
      ],
      [String(this.cap.minute), String(this.cap.day), String(revision), rid],
    );
    if (admission === 1)
      throw new AppError(
        429,
        "SESSION_LIMIT",
        "새 대화를 지금은 더 시작하기 어려워요. 잠시 후 다시 시도해 주세요.",
      );
    this.check(admission);
    const reserve = Math.min(60, Math.max(6, Math.ceil(this.cap.global * 0.15)));
    const ceiling = record ? this.cap.global : Math.max(1, this.cap.global - reserve);
    return this.receipt(keys, sid, cid, rid, ceiling, true);
  }
  private receipt(
    keys: string[],
    sid: string,
    cid: string,
    rid: string,
    ceiling: number,
    guided = false,
  ) {
    return {
      stage: async (next: number) =>
        this.check(
          await this.store.eval(
            "stage_reply",
            [keys[1], keys[5], this.receiptKeys(sid, cid, rid)[0]],
            [rid, String(next)],
          ),
        ),
      extra: async () => {
        const code = await this.store.eval(EXTRA, [keys[1], keys[4]], [rid, String(ceiling)]);
        if (guided && code === 1)
          throw new AppError(
            429,
            "CHAT_BUDGET",
            "지금은 새 답변을 만들기 어려워요. 잠시 후 다시 요청하거나 지금까지 나눈 마음을 정리할 수 있어요.",
          );
        this.check(code);
      },
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
