// Tokenize only COMPLETE JSON strings. Never JSON.parse an incomplete object.
// String boundaries survive escaped quotes, Unicode escapes and arbitrary SDK deltas.
export class ReplyFields {
  private token = "";
  private quoted = false;
  private escaped = false;
  private key = "";
  private expectingKey = true;
  private inSentences = false;
  hasSentenceText = false;
  mode = "";
  safety = "";
  sentences: string[] = [];
  push(delta: string) {
    if (delta.length > 20000) throw new Error("Oversized response");
    const ready: string[] = [];
    for (const c of delta) {
      if (this.quoted) {
        if (this.inSentences && c.trim() && c !== '"' && c !== "\\") this.hasSentenceText = true;
        this.token += c;
        if (this.escaped) {
          this.escaped = false;
          continue;
        }
        if (c === "\\") {
          this.escaped = true;
          continue;
        }
        if (c === '"') {
          this.quoted = false;
          const value = JSON.parse(this.token) as string;
          this.token = "";
          if (this.inSentences) {
            this.sentences.push(value);
            ready.push(value);
          } else if (this.expectingKey) {
            this.key = value;
            this.expectingKey = false;
          } else {
            if (this.key === "mode") this.mode = value;
            else if (this.key === "safety") this.safety = value;
            else if (this.key === "question") {
              if (!this.mode || !this.safety || this.sentences.length !== 1)
                throw new Error("Missing opening reflection");
              this.sentences.push(value);
              ready.push(value);
            } else if (
              this.key !== "diaryDraft" &&
              this.key !== "sourceQuote" &&
              this.key !== "perspectiveQuote"
            )
              throw new Error("Unknown response field");
          }
        }
      } else if (c === '"') {
        this.quoted = true;
        this.token = '"';
      } else if (c === "{" && this.key === "reply") {
        this.expectingKey = true;
      } else if (c === "[") {
        if (this.key !== "sentences" || !this.mode || !this.safety)
          throw new Error("Missing response header");
        this.inSentences = true;
      } else if (c === "]") this.inSentences = false;
      else if (c === "," && !this.inSentences) this.expectingKey = true;
    }
    return ready;
  }
}
