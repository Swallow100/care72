// 受け入れの入口のうち、検索と避難所の一覧（docs/tasks/T23.md）。事業所をまたぐ（所属なしの人も入る）。
//
// ヒットに出すのは氏名カナ・生年月日・年齢だけ。漢字の氏名・住所・電話・事業所・担当・医療の中身は返さない
// （型にも持たない。受け入れて初めて本人のページを開ける。lib/auth/scope.ts）。
// 年齢は生年月日から。生年月日の無い人（その場で登録した人）は申告の年齢。
// 全件を返さない: 検索は生年月日か氏名・カナ 2 字以上（lib/custody/forms.ts の parseSearch）、数は SEARCH_LIMIT まで。

import type { D1Database } from "@cloudflare/workers-types";
import { ageOn } from "../age.ts";
import type { StaffActor } from "./actor.ts";
import type { SearchInput } from "./forms.ts";

export const SEARCH_LIMIT = 30;

/** 検索・避難所の一覧の 1 行。住所・電話・漢字の氏名は持たない */
export type PersonHit = {
  id: string;
  kana: string;
  /** YYYY-MM-DD。分からなければ null */
  birthDate: string | null;
  age: number | null;
  /** 年齢が申告の値（生年月日が無い） */
  ageReported: boolean;
  /** 自分がもう受け入れている */
  mine: boolean;
};

type HitRow = {
  id: string;
  kana: string;
  birth_date: string | null;
  reported_age: number | null;
  mine: number;
};

export function toHit(r: HitRow, today: string): PersonHit {
  const age = r.birth_date ? ageOn(r.birth_date, today) : r.reported_age;
  return {
    id: r.id,
    kana: r.kana,
    birthDate: r.birth_date,
    age: age ?? null,
    ageReported: !r.birth_date && r.reported_age !== null,
    mine: Number(r.mine) === 1,
  };
}

/** LIKE の % _ \ を文字として扱う */
function likeText(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const MINE = `EXISTS (SELECT 1 FROM custody c WHERE c.person_id = p.id AND c.holder_id = ?1 AND c.released_at IS NULL)`;
// 比べる側も空白（半角・全角）を除く
const SQUASH = (col: string) => `replace(replace(${col}, ' ', ''), '　', '')`;

export type SearchResult = { hits: PersonHit[]; more: boolean };

/** 氏名・カナ・生年月日で探す。カナは部分一致、生年月日は一致。両方あれば両方に合う人 */
export async function searchPeople(db: D1Database, actor: StaffActor, q: SearchInput, today: string): Promise<SearchResult> {
  const res = await db
    .prepare(
      `SELECT p.id, p.kana, p.birth_date, p.reported_age, ${MINE} AS mine FROM people p
        WHERE (?2 = '' OR ${SQUASH("p.kana")} LIKE ?3 ESCAPE '\\' OR ${SQUASH("p.name")} LIKE ?3 ESCAPE '\\')
          AND (?4 IS NULL OR p.birth_date = ?4)
        ORDER BY p.kana, p.birth_date, p.id
        LIMIT ?5`,
    )
    .bind(actor.accountId, q.text, likeText(q.text), q.birth, SEARCH_LIMIT + 1)
    .all<HitRow>();
  const rows = res.results;
  return { hits: rows.slice(0, SEARCH_LIMIT).map((r) => toHit(r, today)), more: rows.length > SEARCH_LIMIT };
}

export type ShelterCount = { shelter: string; people: number };

/** 受け持ちの開いている避難所と人数（誰が受け入れたかを問わない）。名前の順 */
export async function listShelters(db: D1Database): Promise<ShelterCount[]> {
  const res = await db
    .prepare(
      `SELECT shelter, count(DISTINCT person_id) AS people FROM custody
        WHERE released_at IS NULL GROUP BY shelter ORDER BY shelter`,
    )
    .all<{ shelter: string; people: number }>();
  return res.results.map((r) => ({ shelter: r.shelter, people: Number(r.people) }));
}

/** 避難所で受け入れられている人（誰が受け入れたかを問わない）。カナの順。自分がもう受け入れた人も印つきで */
export async function shelterPeople(db: D1Database, actor: StaffActor, shelter: string, today: string): Promise<PersonHit[]> {
  const res = await db
    .prepare(
      `SELECT p.id, p.kana, p.birth_date, p.reported_age, ${MINE} AS mine FROM people p
        WHERE EXISTS (SELECT 1 FROM custody s WHERE s.person_id = p.id AND s.shelter = ?2 AND s.released_at IS NULL)
        ORDER BY p.kana, p.birth_date, p.id`,
    )
    .bind(actor.accountId, shelter)
    .all<HitRow>();
  return res.results.map((r) => toHit(r, today));
}
