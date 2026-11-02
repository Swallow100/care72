// パスワードのハッシュ。Web Crypto の PBKDF2（SHA-256）で、Workers と Node の両方で動く。
// 形は "pbkdf2-sha256:<反復回数>:<salt>:<hash>"（salt と hash は base64url）。反復回数と salt を文字列に含める。
// 区切りを ":" にしたのは、手元の鍵のファイル（dotenv の形）で "$" が変数の展開に読まれることがあるため。
// 反復回数は 100,000。Cloudflare Workers の PBKDF2 は 100,000 回より多いと動かない（Node では動いてしまう）。
// 作るのは npm run hash-password（tools/hash-password.ts）。平文は保存しない・ログに出さない。

import { fromBase64Url, sameBytes, toBase64Url, utf8 } from "./bytes.ts";

export const PBKDF2_ITERATIONS = 100_000;
/** Workers の上限。これより多い回数のハッシュは配信先で確かめられないので受けない */
export const MAX_PBKDF2_ITERATIONS = 100_000;
const PREFIX = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** 長すぎる入力は確かめる前に断る（ログインの欄に大きな物を送られたとき） */
export const MAX_PASSWORD_LENGTH = 1024;

export type ParsedPasswordHash = {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
};

/** 同じ文字でも入力のしかたで符号が違うことがあるので NFC にそろえる */
function normalize(password: string): string {
  return password.normalize("NFC");
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", utf8(normalize(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  opts: { iterations?: number; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<string> {
  if (password.length === 0) throw new Error("パスワードが空");
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("パスワードが長すぎる");
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error("反復回数が範囲の外");
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${PREFIX}:${iterations}:${toBase64Url(salt)}:${toBase64Url(hash)}`;
}

/** 形が違えば null（前後の空白は許さない。写し間違いを早く見つけるため） */
export function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  if (!/^[1-9][0-9]*$/.test(parts[1])) return null;
  const iterations = Number(parts[1]);
  if (iterations > MAX_PBKDF2_ITERATIONS) return null;
  const salt = fromBase64Url(parts[2]);
  const hash = fromBase64Url(parts[3]);
  if (!salt || !hash || salt.length < 8 || hash.length !== KEY_BYTES) return null;
  return { iterations, salt, hash };
}

export function isPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== null;
}

/** 見つからない ID・ハッシュの無いアカウントにも同じだけ時間をかける（ID が有るかを時間で分からせない） */
const DUMMY_SALT = new Uint8Array(SALT_BYTES);

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const tooLong = password.length > MAX_PASSWORD_LENGTH;
  const parsed = stored ? parsePasswordHash(stored) : null;
  if (!parsed || tooLong || password.length === 0) {
    await derive(tooLong || password.length === 0 ? "-" : password, DUMMY_SALT, PBKDF2_ITERATIONS);
    return false;
  }
  const got = await derive(password, parsed.salt, parsed.iterations);
  return sameBytes(got, parsed.hash);
}
