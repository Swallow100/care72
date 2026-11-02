// npm run -s hash-password: パスワードのハッシュを作る（lib/auth/password.ts の形。PBKDF2-SHA256・100,000 回）。
// パスワードは引数でなく標準入力から読む（引数はシェルの履歴とプロセスの一覧に残る）。
// 端末なら 2 回入れてもらい、画面に出さない（* も出さない）。管で渡したとき（< ファイル など）は 1 行目を読む。
// 標準出力に出すのはハッシュの 1 行だけ。案内は標準エラーへ。作ったハッシュは手元の鍵のファイルか Cloudflare の secret に入れる。
import { hashPassword, MAX_PASSWORD_LENGTH } from "../lib/auth/password.ts";

const MIN_LENGTH = 8;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** 端末から 1 行。打った字は出さない */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let value = "";
    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") return finish(new Error("中止"));
        if (ch === "\u007f" || ch === "\b") {
          value = [...value].slice(0, -1).join("");
          continue;
        }
        if (ch < " ") continue;
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** 管から。1 行目だけ（改行は含めない） */
async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

async function main(): Promise<void> {
  let password: string;
  if (process.stdin.isTTY) {
    const first = await readHidden("パスワード: ");
    const second = await readHidden("もう一度: ");
    if (first !== second) fail("2 回の入力が違う");
    password = first;
  } else {
    password = await readPiped();
  }
  if (password.length < MIN_LENGTH) fail(`短い（${MIN_LENGTH} 字以上）`);
  if (password.length > MAX_PASSWORD_LENGTH) fail(`長い（${MAX_PASSWORD_LENGTH} 字まで）`);
  process.stdout.write(`${await hashPassword(password)}\n`);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : "失敗"));
