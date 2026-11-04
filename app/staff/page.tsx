import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/disaster/AutoRefresh";
import { ColorCounts } from "@/components/disaster/ColorCounts";
import { StaffIntake } from "@/components/staff/StaffIntake";
import { StaffTable } from "@/components/staff/StaffTable";
import { StaffCsvLink } from "@/components/staff/StaffCsvLink";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { staffActor } from "@/lib/custody/actor";
import { loadStaffBoard, type StaffBoard } from "@/lib/custody/board";
import { CUSTODY_ERROR_LABELS, CUSTODY_ERRORS, CUSTODY_LABELS, type CustodyError } from "@/lib/custody/labels";
import { listShelters, type ShelterCount } from "@/lib/custody/search";
import { parseStaffView } from "@/lib/custody/staff-view";
import { lastShelter } from "@/lib/custody/store";
import { shortJst } from "@/lib/disaster/state";

export const metadata: Metadata = { title: `${CUSTODY_LABELS.page} | ケア72` };

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Param = string | string[];
type Props = { searchParams: Promise<{ error?: Param; shelter?: Param; color?: Param; q?: Param; sort?: Param }> };

function parseError(v: unknown): CustodyError | null {
  return typeof v === "string" && (CUSTODY_ERRORS as readonly string[]).includes(v) ? (v as CustodyError) : null;
}

// 行政・医療班の受け持ち（docs/SPEC.md「画面 6」、docs/tasks/T23.md）。自分のアカウントで受け入れた人の一覧。事業所をまたぐ。
// 上に人数（状態の 4 色と要配慮）、左に表（避難所・状態・氏名で絞り、列で並べ替え）、右に受入の入口（検索・避難所・新規登録）。
// QR は本人の 1 枚の裏から /q/<token> を開き、その頁の「受入」から（受け入れるとここへ戻る）。
// 状態はケアマネの一覧と同じルールの表（lib/custody/board.ts）。1 分ごとに読み直す（時計が進む）
// 見出しの行の右に「CSV出力」（T62、/staff/csv）。表の絞込と並びは URL に載せ（lib/custody/staff-view.ts）、CSV は画面と同じ行を書く
export default async function StaffPage({ searchParams }: Props) {
  const principal = await requirePage("staff");
  const actor = staffActor(principal);
  const q = await searchParams;
  const error = parseError(q.error);
  const now = new Date().toISOString();

  let board: StaffBoard = { rows: [], counts: { red: 0, yellow: 0, gray: 0, green: 0 }, shelters: [], medical: 0 };
  let shelters: ShelterCount[] = [];
  let last: string | null = null;
  if (actor) {
    const { env } = await getCloudflareContext({ async: true });
    [board, shelters, last] = await Promise.all([
      loadStaffBoard(env.DB, actor, todayJst(), now),
      listShelters(env.DB, actor),
      lastShelter(env.DB, actor),
    ]);
  }

  return (
    // 受入の入口は 1280px から右に。それ未満は表の下（表を横に送らない）。右の面は留めず、ページの流れに置く
    <main className="mx-auto grid max-w-[90rem] grid-cols-[minmax(0,1fr)] gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
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
          {/* 書き出し（T62）: 表の今の絞込と並びのまま（URL の query を持ち越す） */}
          <StaffCsvLink className="ml-auto self-center" />
        </div>
        {error && (
          <p role="alert" className="mt-1 text-sm font-bold text-danger">
            {CUSTODY_ERROR_LABELS[error]}
          </p>
        )}
        <div className="mt-2">
          <StaffTable rows={board.rows} shelters={board.shelters} view={parseStaffView(q)} />
        </div>
      </div>
      <aside className="min-w-0 self-start">
        <StaffIntake shelters={shelters} defaultShelter={last} />
      </aside>
    </main>
  );
}
