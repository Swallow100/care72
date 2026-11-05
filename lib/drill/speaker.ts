// 本人役の話し手（T121）。家族・支援者から連絡するときに誰が話すかを台帳の連絡先から決め、AI に変えさせない。
// 評価の 1 回目で、家族の連絡の話し手の続柄が途中で変わる（夫の連絡が途中から本人を「母」と呼ぶ、など）のが見えた。
// 指示の決まりが本人の呼び方を一般の例（母・父・うちの人）で書いていたことと、前の連絡の言葉が次の入力に入って誤りが続くことが元。
//
// - 話し手は、押せる人を先に、近く住む人（同居・近所・市内・県外・遠方）を先に、台帳の並びの順で 1 人（家族・支援者それぞれ）
// - 本人の呼び方は話し手の続柄と本人の性別から（夫 → 妻・家内、娘 → 母、孫 → 祖母・おばあちゃん…）。分からなければ「本人」
// - 言葉の確かめは確かな物だけ: 夫・妻の話し手が本人を「母」「父」と呼ぶ文と、話し手でない続柄で名乗る文（「娘です」）を落とす
// - Claude を呼ばない。名前・電話は扱わない（続柄と役割名だけ）

import type { ContactRow, Sex } from "../db/types.ts";

/** 連絡先の住む所の近さの順（近いほど先） */
const REACH_ORDER: ReadonlyArray<ContactRow["reach"]> = ["together", "nearby", "in_city", "out_of_pref", "far", null];

/** 話し手 1 人。role は本人役の周りの人の役割名（娘・夫・支援者 1）、calls は本人の呼び方（先頭が主） */
export type Speaker = { role: string; source: "family" | "supporter"; calls: ReadonlyArray<string> };
export type Speakers = { family: Speaker | null; supporter: Speaker | null };

/** 役割名の番号を外した続柄（「娘 2」→「娘」） */
export const relationOf = (role: string): string => role.replace(/[ 　]*\d+$/u, "").trim();

const f = (sex: Sex | null | undefined, female: string[], male: string[]): string[] | null =>
  sex === "female" ? female : sex === "male" ? male : null;

/** 続柄 → 本人の呼び方（性別が分からなければ null）。並びは確かめる順（孫娘は孫、長男の嫁は嫁） */
const KIN: ReadonlyArray<readonly [RegExp, (sex: Sex | null | undefined) => string[] | null, "spouse" | "other"]> = [
  [/孫/u, (s) => f(s, ["祖母", "おばあちゃん"], ["祖父", "おじいちゃん"]), "other"],
  [/嫁|婿|義理/u, (s) => f(s, ["義母", "お義母さん"], ["義父", "お義父さん"]), "other"],
  [/^(?:夫|主人)$/u, () => ["妻", "家内", "うちの人"], "spouse"],
  [/^(?:妻|家内)$/u, () => ["主人", "夫", "うちの人"], "spouse"],
  [/(?:娘|息子|長男|長女|次男|次女|三男|三女)$/u, (s) => f(s, ["母"], ["父"]), "other"],
  [/^(?:甥|姪)/u, (s) => f(s, ["叔母"], ["叔父"]), "other"],
  [/^(?:弟|妹)$/u, (s) => f(s, ["姉"], ["兄"]), "other"],
  [/^(?:兄|姉)$/u, (s) => f(s, ["妹"], ["弟"]), "other"],
];

/** 話し手の続柄が夫・妻か */
export function isSpouse(role: string): boolean {
  const r = relationOf(role);
  return KIN.some(([re, , kind]) => kind === "spouse" && re.test(r));
}

/** 本人の呼び方（話し手の続柄と本人の性別から）。分からなければ「本人」 */
export function callsFor(role: string, source: Speaker["source"], sex: Sex | null | undefined): string[] {
  if (source === "supporter") return f(sex, ["おばあちゃん"], ["おじいちゃん"]) ?? ["本人"];
  const r = relationOf(role);
  for (const [re, calls] of KIN) if (re.test(r)) return calls(sex) ?? ["本人"];
  return ["本人"];
}

type ContactLike = Pick<ContactRow, "kind" | "reach" | "has_smartphone">;

/**
 * 家族と支援者の話し手を 1 人ずつ。roles は連絡先と同じ並びの役割名（lib/pseudonym の contactRoles）。
 * 押せる（スマホのある）人を先に、近く住む人を先に、台帳の並びの順
 */
export function speakersOf(contacts: ReadonlyArray<ContactLike>, roles: ReadonlyArray<string>, sex: Sex | null | undefined): Speakers {
  const pick = (kinds: ReadonlyArray<ContactRow["kind"]>, source: Speaker["source"]): Speaker | null => {
    const list = contacts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => kinds.includes(c.kind))
      .sort(
        (a, b) =>
          Number(b.c.has_smartphone === 1) - Number(a.c.has_smartphone === 1) ||
          REACH_ORDER.indexOf(a.c.reach ?? null) - REACH_ORDER.indexOf(b.c.reach ?? null) ||
          a.i - b.i,
      );
    const top = list[0];
    if (!top) return null;
    const role = roles[top.i];
    return { role, source, calls: callsFor(role, source, sex) };
  };
  return { family: pick(["family"], "family"), supporter: pick(["supporter", "welfare_commissioner"], "supporter") };
}

/** 本人役の説明に足す 1 行（話し手と本人の呼び方）。話し手がいなければ null */
export function speakersLine(s: Speakers): string | null {
  const parts = [s.family, s.supporter]
    .filter((x): x is Speaker => x !== null)
    .map((x) => `${x.source === "family" ? "家族" : "支援者"}から連絡するのは ${x.role}（本人を「${x.calls.join("」「")}」と呼ぶ）`);
  return parts.length > 0 ? `話す人: ${parts.join("。")}。ほかの人に替えない` : null;
}

/** 家族の名乗りの続柄（台帳に無い続柄で名乗る文も見る。「娘です」） */
const KIN_NAMES: ReadonlyArray<string> = ["夫", "妻", "娘", "息子", "長男", "長女", "次男", "次女", "孫", "嫁", "甥", "姪", "弟", "妹", "兄", "姉"];

/** 夫・妻の話し手が本人を親の呼び方（母・父）で呼ぶ形。「お母さん」「祖母」「義母」は含めない */
const PARENT_CALL = /(?<![祖義叔伯お])[母父](?:は|が|を|に|の|も|と|、|。|です|$)/u;

/**
 * 話し手の続柄に合わない文か。speaker は話した人（無ければ見ない）、others は本人の周りの人の役割名（話し手を除いて、名乗りの確かめ）
 */
export function speakerSlip(sentence: string, speaker: Speaker | null, others: ReadonlyArray<string>): boolean {
  if (!speaker) return false;
  if (isSpouse(speaker.role) && PARENT_CALL.test(sentence)) return true;
  const own = relationOf(speaker.role);
  for (const o of new Set([...others, ...(speaker.source === "family" ? KIN_NAMES : [])])) {
    const r = relationOf(o);
    if (!r || r === own) continue;
    if (new RegExp(`(?:^|[、。！？\\s])${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:です|でございます|だけど|ですが)`, "u").test(` ${sentence}`)) return true;
  }
  return false;
}
