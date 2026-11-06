import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { ColorCounts } from "@/components/disaster/ColorCounts";
import { StaffIntake, type QrSampleView } from "@/components/staff/StaffIntake";
import { StaffTable } from "@/components/staff/StaffTable";
import { StaffCsvLink } from "@/components/staff/StaffCsvLink";
import { StaffPassword } from "@/components/staff/StaffPassword";
import { StaffRequests } from "@/components/staff/StaffRequests";
import { todayJst } from "@/lib/age";
import { ownLoginId, ownPasswordEntry, wantsOwnPassword } from "@/lib/auth/password-change";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { staffActor } from "@/lib/custody/actor";
import { loadStaffBoard, type StaffBoard } from "@/lib/custody/board";
import { CUSTODY_ERROR_LABELS, CUSTODY_ERRORS, CUSTODY_LABELS, type CustodyError } from "@/lib/custody/labels";
import { listShelters, type ShelterCount } from "@/lib/custody/search";
import { openRequests, type RequestHit } from "@/lib/custody/requests";
import { parseStaffView } from "@/lib/custody/staff-view";
import { lastShelter } from "@/lib/custody/store";
import { parseReceived } from "@/lib/custody/entry";
import { qrSamples } from "@/lib/custody/samples";
import { headers } from "next/headers";
import { qrMatrix, qrSvgPath, QR_QUIET } from "@/lib/qr/image";
import { originFromHeaders, qrUrl } from "@/lib/qr/url";
import { shortJst } from "@/lib/disaster/state";

export const metadata: Metadata = { title: `${CUSTODY_LABELS.page} | ケア72` };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Param = string | string[];
// password はヘッダーの「初期パスワード」の「変更」から（変更の欄を開いて出す。T114）
type Props = {
  searchParams: Promise<{ error?: Param; shelter?: Param; color?: Param; q?: Param; sort?: Param; password?: Param; received?: Param }>;
};

function parseError(v: unknown): CustodyError | null {
  return typeof v === "string" && (CUSTODY_ERRORS as readonly string[]).includes(v) ? (v as CustodyError) : null;
}

// 行政・医療班の受け持ち（docs/SPEC.md「画面 6」、docs/tasks/T23.md）。自分のアカウントで受け入れた人の一覧。事業所をまたぐ。
// 上に人数（状態の 4 色と要配慮）、その下に受入の入口（T152: 避難所の欄と入り方の 3 つ〔QR 読取・氏名検索・新規登録〕。どの幅も表の上）、
// その下に表（避難所・状態・氏名で絞り、列で並べ替え）。QR は本人の 1 枚の裏の /q/<token> の頁の「受入」から。
// 受け入れたらここへ ?received=<受け持ちの id> で戻り、その人の行を表の上に「新着」で出す（並びの番号はルールの表のまま）。
// 審査員の壁の中（デモ事業所）は、QR 読取に見本の QR（lib/custody/samples.ts。端末のカメラを使わずに試せる）。
// 状態はケアマネの一覧と同じルールの表（lib/custody/board.ts）。1 分ごとに読み直す（時計が進む）
// 見出しの行の右に「CSV出力」（T62、/staff/csv）。表の絞込と並びは URL に載せ（lib/custody/staff-view.ts）、CSV は画面と同じ行を書く
// 受入の入口の上に、ケアマネ（事業所）からの受入依頼（T163。lib/custody/requests.ts）。受入で今の受け入れを通し、行がここの表に入る
// その右に「パスワード変更」（T99。医療班・行政のアカウントだけ。審査員と固定のアカウントは「固定」の印。lib/auth/password-change.ts の ownPasswordEntry）
export default async function StaffPage({ searchParams }: Props) {
  const principal = await requirePage("staff");
  const actor = staffActor(principal);
  const entry = ownPasswordEntry(principal);
  const q = await searchParams;
  const error = parseError(q.error);
  const now = new Date().toISOString();

  let board: StaffBoard = { rows: [], counts: { red: 0, yellow: 0, gray: 0, green: 0 }, shelters: [], medical: 0 };
  let shelters: ShelterCount[] = [];
  let last: string | null = null;
  let loginId: string | null = null;
  let samples: QrSampleView[] = [];
  let requests: RequestHit[] = [];
  if (actor) {
    const { env } = await getCloudflareContext({ async: true });
    const origin = originFromHeaders(await headers());
    const found = await qrSamples(env.DB, principal, sessionSecret(env), nowSec());
    // 見本の QR の点の並び（本人の 1 枚の裏と同じ URL。ほかの端末のカメラで読める）。元が分からなければ点の並びは作らない
    samples = origin
      ? found.map((x) => {
          const m = qrMatrix(qrUrl(origin, x.token));
          return { ...x, qr: { size: m.size + QR_QUIET * 2, d: qrSvgPath(m) } };
        })
      : [];
    [board, shelters, last, loginId, requests] = await Promise.all([
      loadStaffBoard(env.DB, actor, todayJst(), now),
      listShelters(env.DB, actor),
      lastShelter(env.DB, actor),
      // パスワードの欄の隠した ID（パスワードの管理の道具が組にできるように）
      entry === "open" && principal.accountId ? ownLoginId(env.DB, principal.accountId) : null,
      // 医療班への受入依頼（T163。医療班の役だけ、審査員はデモの人の依頼だけ）
      openRequests(env.DB, actor, todayJst()),
    ]);
  }

  return (
    // 受入の入口は表の上（T152。前は 1280px から右の面、それ未満は表の下で、どこから受け入れるか分かりにくかった）
    <main className="mx-auto max-w-[90rem] space-y-3 px-4 py-4">
      <AutoRefresh seconds={60} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl leading-8 font-bold">{CUSTODY_LABELS.page}</h1>
          <span className="text-sm">
            <span className="text-lg font-bold tabular-nums">{board.rows.length}</span> {CUSTODY_LABELS.people}
          </span>
          <ColorCounts counts={board.counts} />
          <span className="flex items-baseline gap-1 text-sm">
            <span className="text-muted">{CUSTODY_LABELS.care}</span>
            <span className="font-bold tabular-nums">{board.medical}</span>
          </span>
          <span className="text-xs text-muted">
            {shortJst(now)} {CUSTODY_LABELS.at}
          </span>
          {/* 書き出し（T62）: 表の今の絞込と並びのまま（URL の query を持ち越す）。その右に自分のパスワードの変更（T99。欄はこの行の下に開く） */}
          <StaffPassword entry={entry} loginId={loginId} initialOpen={wantsOwnPassword(q.password)}>
            <StaffCsvLink />
          </StaffPassword>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger">
            {CUSTODY_ERROR_LABELS[error]}
          </p>
        )}
      </div>
      {/* 受入依頼（T163）は受入の入口の上。依頼が無ければ出さない */}
      <StaffRequests requests={requests} />
      <StaffIntake shelters={shelters} defaultShelter={last} samples={samples} />
      <StaffTable rows={board.rows} shelters={board.shelters} view={parseStaffView(q)} received={parseReceived(q)} />
    </main>
  );
}
