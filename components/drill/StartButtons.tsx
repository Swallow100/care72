"use client";

// 訓練の開始（大雨想定・地震想定・10 分版）。押すと 0 時間まで当てて保存し、訓練の画面へ。
// 事業所に進行中があれば断られる（実施中あり）。そのときは一覧の進行中から再開か中断。
// 主の操作の色は 10 分版（審査員がまず押す方、11/3 03:3x の確定）だけで、先頭に並べる（11/3 08:0x の確定 3。並びは lib/drill の
// SCENARIO_ORDER を変えずにここで前へ出す）。大雨・地震の想定は無色。押してから画面が移るまで、押したボタンに灰色を残す（data-pending）。
//
// 設定（T59）: 想定のボタンの前に畳んだ「設定」。開くと参加者（担当一覧の人のチェック。既定は全員）・職員（既定は想定の表の値）・夜間発災。
// 閉じたまま・何も変えずに想定を押せば、送る物は前と同じ { scenario } だけ（選んだ物だけ options に入れる）。
// 開く・閉じるは details を使わずボタン（既定の黒い▼を出さない）。選んだ印はチェックの印だけで、下地を敷かない。
//
// T70: 参加者のうち、本人も家族・支援者もスマホで赤緑を押せない人に「押せる人なし」（灰の文字。名前は本人のページへ。スマホを入れるのはそこ）。
// 押せる人のいない人は本人役（AI）が呼ばれず、表の行が当たったときだけ表の固定の安否が届く。
// 想定のボタンの下に、選んだ参加者での AI の呼び出しの見込み（lib/drill/estimate.ts）。今日の残りはすぐ下の行（app/drill/page.tsx の「AI 残り」）
// にあるので、ここでは比べるだけにして並べない。見込みが残りを超える想定には
// 「上限不足」（赤の文字）。開始は止めない（途中で当たれば刻みに「停止」の印）

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { DrillScenario } from "@/lib/db/types";
import { Button } from "@/components/ui/Button";
import { OpenIcon, PlayIcon } from "@/components/ui/Icon";
import { LABEL } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { estimateDrillCalls, overLimit } from "@/lib/drill/estimate";
import { DRILL_LABELS, SCENARIO_LABELS, T59_LABELS, T70_LABELS } from "@/lib/drill/labels";
import { STAFF_MAX } from "@/lib/drill/options";

/** 主の操作の色にする想定 */
const MAIN_SCENARIO: DrillScenario = "short";

/**
 * 担当一覧の人（参加者の選択）。canPress が false の人に「押せる人なし」（無ければ印なし）、callable は本人役を呼びうる想定
 * （見込みに使う。無ければ全部の想定で数える）
 */
export type StartPerson = { id: string; name: string; canPress?: boolean; callable?: ReadonlyArray<DrillScenario> };

const SELECT =
  "h-8 min-w-0 rounded bg-panel px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** チェックの行。押したときは灰色だけ（data-press）。375px でも押せる高さ */
const CHECK_ROW = "flex min-h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded px-1.5 text-sm";
const CHECK = "size-4 shrink-0 accent-accent";
/** 押せる人なしの人の名前（本人のページへ。下線の文字、押したときは灰色だけ） */
const NAME_LINK =
  "min-w-0 truncate rounded px-0.5 underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function StartButtons({
  scenarios,
  disabled,
  people = [],
  remaining = null,
}: {
  scenarios: ReadonlyArray<DrillScenario>;
  disabled: boolean;
  /** 担当一覧の人（参加者の選択。無ければ設定の参加者を出さない） */
  people?: ReadonlyArray<StartPerson>;
  /** 今日の AI の残り（lib/claude/gate.ts の drillGate と同じ値。上限不足の判定だけに使う。読めなければ null） */
  remaining?: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<DrillScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(people.map((p) => p.id)));
  const [staff, setStaff] = useState("");
  const [night, setNight] = useState(false);
  const boxId = useId();

  const all = chosen.size === people.length;
  const none = people.length > 0 && chosen.size === 0;
  const picked = people.filter((p) => chosen.has(p.id));
  // 押せる人なし（選んだ参加者のうち）
  const noPresser = picked.filter((p) => p.canPress === false).length;
  const ordered = [...scenarios].sort((a, b) => Number(b === MAIN_SCENARIO) - Number(a === MAIN_SCENARIO));

  /** 選んだ物だけ（何も変えなければ undefined。送る物は前と同じ） */
  const options = () => {
    const o: { participants?: string[]; staff?: number; night?: boolean } = {};
    if (!all) o.participants = people.filter((p) => chosen.has(p.id)).map((p) => p.id);
    if (staff !== "") o.staff = Number(staff);
    if (night) o.night = true;
    return Object.keys(o).length > 0 ? o : undefined;
  };

  const toggle = (id: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async (scenario: DrillScenario) => {
    setBusy(scenario);
    setError(null);
    try {
      const o = options();
      const res = await fetch("/api/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(o ? { scenario, options: o } : { scenario }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; label?: string } | null;
      if (!res.ok || !body?.ok || !body.id) {
        setError(body?.label ?? String(res.status));
        setBusy(null);
        router.refresh();
        return;
      }
      // 訓練の画面が出るまで押したボタンの灰色を残す（busy は戻さない。画面が移ればこの部品は消える）
      router.push(`/drill/${encodeURIComponent(body.id)}`);
    } catch {
      setError(DRILL_LABELS.network);
      setBusy(null);
    }
  };

  const changed = options() !== undefined;

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${open ? "w-full" : ""}`} data-start>
      <Button
        kind="quiet"
        icon={OpenIcon}
        aria-expanded={open}
        aria-controls={boxId}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy !== null}
        className={open ? "[&>svg]:rotate-180" : ""}
        data-start-settings
        data-changed={changed ? "" : undefined}
      >
        {T59_LABELS.settings}
        {changed && !open && <span className="text-xs font-normal text-muted">{settingsSummary(people.length, chosen.size, staff, night)}</span>}
      </Button>
      {ordered.map((s) => (
        <Button
          key={s}
          kind={s === MAIN_SCENARIO ? "main" : "plain"}
          icon={PlayIcon}
          onClick={() => void start(s)}
          disabled={disabled || busy !== null || none}
          data-scenario={s}
          data-pending={busy === s ? "" : undefined}
        >
          {SCENARIO_LABELS[s]}
        </Button>
      ))}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
      {people.length > 0 && !none && (
        <p className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted tabular-nums" data-estimate>
          <span>{T70_LABELS.estimate}</span>
          {ordered.map((s) => {
            const n = estimateDrillCalls(s, picked);
            const over = overLimit(n, remaining);
            return (
              <span key={s} data-estimate-scenario={s} data-estimate-calls={n} data-over={over ? "" : undefined}>
                {SCENARIO_LABELS[s]} {T70_LABELS.about} {n} {T70_LABELS.times}
                {over && <span className="ml-1 font-bold text-danger">{T70_LABELS.short}</span>}
              </span>
            );
          })}
          {noPresser > 0 && (
            <span data-no-presser-count={noPresser}>
              {T70_LABELS.noPresser} {noPresser} {T59_LABELS.people}
            </span>
          )}
        </p>
      )}
      {open && (
        <div id={boxId} className="basis-full space-y-2 rounded-md bg-panel2 px-2.5 py-2" data-start-options>
          {people.length > 0 && (
            <fieldset className="min-w-0" data-start-participants>
              <legend className={`mb-1 flex w-full flex-wrap items-center gap-x-2 ${LABEL}`}>
                <span>{T59_LABELS.participants}</span>
                <span className="tabular-nums">
                  {chosen.size} / {people.length} {T59_LABELS.people}
                </span>
                {noPresser > 0 && (
                  <span className="font-normal tabular-nums">
                    {T70_LABELS.noPresser} {noPresser} {T59_LABELS.people}
                  </span>
                )}
                {none && <span className="font-bold text-danger">{T59_LABELS.noParticipants}</span>}
                <Button
                  kind="plainIn"
                  size="sm"
                  onClick={() => setChosen(all ? new Set() : new Set(people.map((p) => p.id)))}
                  data-start-all
                >
                  {T59_LABELS.all}
                </Button>
              </legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-2 gap-y-0.5">
                {people.map((p) =>
                  p.canPress === false ? (
                    // 押せる人なし: 名前は本人のページへ（スマホを入れる所）。チェックは名前でなく四角だけで切り替える
                    <div key={p.id} className={`${CHECK_ROW} cursor-auto`} data-no-presser={p.id}>
                      <input
                        type="checkbox"
                        className={`${CHECK} cursor-pointer`}
                        checked={chosen.has(p.id)}
                        onChange={() => toggle(p.id)}
                        aria-label={p.name}
                        data-start-person={p.id}
                      />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <Link href={`/people/${encodeURIComponent(p.id)}`} className={NAME_LINK} data-press>
                          {p.name}
                        </Link>
                        <span className="text-xs text-muted">{T70_LABELS.noPresser}</span>
                      </span>
                    </div>
                  ) : (
                    <label key={p.id} className={CHECK_ROW} data-press>
                      <input type="checkbox" className={CHECK} checked={chosen.has(p.id)} onChange={() => toggle(p.id)} data-start-person={p.id} />
                      <span className="min-w-0 truncate">{p.name}</span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-sm">
              <span className={LABEL}>{T59_LABELS.staff}</span>
              <Select value={staff} onChange={(e) => setStaff(e.target.value)} className={SELECT} aria-label={T59_LABELS.staff} data-start-staff>
                <option value="">{T59_LABELS.staffDefault}</option>
                {Array.from({ length: STAFF_MAX + 1 }, (_, n) => (
                  <option key={n} value={String(n)}>
                    {n} {T59_LABELS.people}
                  </option>
                ))}
              </Select>
            </label>
            <label className={CHECK_ROW} data-press>
              <input type="checkbox" className={CHECK} checked={night} onChange={(e) => setNight(e.target.checked)} data-start-night />
              {T59_LABELS.night}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** 閉じた設定に添える選んだ物（「3 人・職員 1・夜間」） */
function settingsSummary(total: number, chosen: number, staff: string, night: boolean): string {
  return [
    chosen !== total ? `${chosen} ${T59_LABELS.people}` : null,
    staff !== "" ? `${T59_LABELS.staff} ${staff}` : null,
    night ? T59_LABELS.night : null,
  ]
    .filter(Boolean)
    .join("・");
}
