// 本人・家族の頁の上の「準備」の欄の決まり（T149）。端末の様子を引数で受ける純な関数（テストは node で回す）。
// 段は 3 つで、この順に 1 つずつ案内する: ID とパスワード（リンクで開いた人だけ）→ ホーム画面に追加 → 通知の許可。
// iPhone はホーム画面に追加したアプリと Safari で cookie を分けるので、先に ID を作るとホーム画面のアプリでログインできる。
// iPhone の通知はホーム画面から開いた時だけ許可できる（Safari の中は「ホーム画面から開いて」）。
// 済むまで出し続ける。閉じるはその表示の間だけ（次に開いた時にまた出す）。済んだら出さない。押さないと先に進めない形にはしない。
// 災害モード（compact）は安否のボタンの上に 1 行だけ（ID の段は出さない。ホーム画面と通知のまだの段と、押せるボタン 1 つ）。

export const SETUP_STEPS = ["account", "install", "notify"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/**
 * 通知の様子。checking 確かめ中・todo まだ・done 済み（許可して購読をサーバーに送った）・need-home iPhone の Safari の中・
 * denied 端末で断った・unsupported このブラウザに無い・off 鍵の無い配信（通知 未設定）・failed 購読を送れなかった
 */
export type NotifyState = "checking" | "todo" | "done" | "need-home" | "denied" | "unsupported" | "off" | "failed";

/** ID の段: hidden 出さない（審査員の役・ID で入った人以外の形）・create まだ・done 作った */
export type AccountState = "hidden" | "create" | "done";

export type SetupInput = {
  account: AccountState;
  /** ホーム画面から開いている・入れた・入れる必要の無い端末（PC） */
  installDone: boolean;
  notify: NotifyState;
  /** この表示の間だけ後に回した段（ID の段の「後で」） */
  skipped: readonly SetupStep[];
};

export function stepDone(step: SetupStep, i: SetupInput): boolean {
  switch (step) {
    case "account":
      return i.account !== "create";
    case "install":
      return i.installDone;
    case "notify":
      return i.notify === "done";
  }
}

/** 欄に並べる段（ID の段は出す人だけ） */
export function setupSteps(i: SetupInput): Array<{ step: SetupStep; done: boolean }> {
  return SETUP_STEPS.filter((s) => s !== "account" || i.account !== "hidden").map((step) => ({ step, done: stepDone(step, i) }));
}

/** 今案内する段（まだの最初の段。後に回した段は、ほかが済むまで飛ばす）。全部済めば null */
export function currentStep(i: SetupInput): SetupStep | null {
  const todo = setupSteps(i).filter((s) => !s.done);
  if (todo.length === 0) return null;
  return (todo.find((s) => !i.skipped.includes(s.step)) ?? todo[0]).step;
}

/** 欄を出すか。compact（災害モード）はホーム画面か通知がまだで、通知が押せる・案内できる時だけ（未設定・非対応だけなら出さない） */
export function setupVisible(i: SetupInput, compact: boolean): boolean {
  if (!compact) return currentStep(i) !== null;
  const notifyOpen = i.notify === "todo" || i.notify === "failed" || i.notify === "need-home" || i.notify === "denied";
  return !i.installDone || notifyOpen;
}

/** 購読の鍵（base64url の公開鍵）をバイト列に（pushManager.subscribe の applicationServerKey） */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 今の購読が同じ鍵で作られた物か（鍵を替えた配信のあとは作り直す） */
export function sameKey(current: ArrayBuffer | null | undefined, base64url: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 入れた印（localStorage）。ホーム画面から開いた時と appinstalled のときに付け、ブラウザのタブでも「済み」にする */
export const INSTALLED_MARK_KEY = "care72:installed";
