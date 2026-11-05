// 見本の QR（T152）。審査員が医療班の役で、端末のカメラを使わずに QR の読み取りからの受入を試せるように、
// 種の事業所の人の本人の 1 枚の QR（/q/<token>）を受入の入口に並べる。
//
// 出すのは壁の中（lib/auth/wall.ts の isWalled: 審査員・審査員が足したアカウント・役を替えた見本のケアマネ）だけで、
// 人は壁の中の人が受け入れられる種の事業所（StaffActor の wallOffice。審査員はデモ事業所、役を替えた山本は確認用の事業所。T144）の人。
// ほかの医療班・行政のアカウントには 1 つも出さない（トークンはログインなしで医療要約の頁を開けるので、デモの人の物でも壁の外へ渡さない）。
// トークンは本人の行の版と時刻から作り直す（lib/qr/store.ts の currentQrToken。表には持たない）。
// 種の事業所（デモ・確認用）の 10 人は QR を作った形（lib/seed/demo.ts の DEMO_QR）。期限の切れた物・自分が受け入れ中の人は出さない。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { currentQrToken, qrState, type QrRow } from "../qr/store.ts";
import { staffActor } from "./actor.ts";

export type QrSample = {
  /** 本人の id（画面の key。画面には出さない） */
  personId: string;
  /** 本人を選ぶための氏名カナ（検索のヒットと同じ。漢字の氏名・住所・電話は出さない） */
  kana: string;
  token: string;
};

/** 並べる数（受入の面を長くしない） */
export const QR_SAMPLE_MAX = 3;

type SampleRow = QrRow & { id: string; kana: string };

/** 見本の QR。壁の外なら空。nowSec は秒 */
export async function qrSamples(
  db: D1Database,
  principal: Principal | null,
  secret: string,
  nowSec: number,
  max: number = QR_SAMPLE_MAX,
): Promise<QrSample[]> {
  const actor = staffActor(principal);
  if (!actor?.walled) return [];
  const office = actor.wallOffice ?? DEMO_OFFICE_ID;
  const { results } = await db
    .prepare(
      `SELECT p.id, p.kana, p.qr_generation, p.qr_issued_at, p.qr_ttl_days
         FROM people p
        WHERE p.office_id = ?1 AND p.qr_generation >= 1
          AND NOT EXISTS (SELECT 1 FROM custody c WHERE c.person_id = p.id AND c.holder_id = ?2 AND c.released_at IS NULL)
        ORDER BY p.id
        LIMIT 20`,
    )
    .bind(office, actor.accountId)
    .all<SampleRow>();
  const out: QrSample[] = [];
  for (const r of results) {
    if (out.length >= max) break;
    if (qrState(r, nowSec).status !== "active") continue;
    const token = await currentQrToken(r.id, r, secret);
    if (token) out.push({ personId: r.id, kana: r.kana, token });
  }
  return out;
}
