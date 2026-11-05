"use client";

// 訓練の開始（大雨想定・地震想定・仮想）。押すと 0 時間まで当てて保存し、訓練の画面へ。
// 事業所に進行中があれば断られる（実施中あり）。そのときは一覧の進行中から再開か中断。
// 並びは lib/drill の SCENARIO_ORDER のまま。主の操作の色は先頭（大雨想定）だけで、ほかは無色。押してから画面が移るまで、押したボタンに灰色を残す（data-pending）。
// T124: 10 分版を外した（前からある 10 分版の記録は一覧・再生・紙で読める）。想定のボタンの下に進め方の 1 行
// （訓練の画面の並びと同じ 手の分・30 分・1 時間・3 時間・次まで、主の操作は次まで。通しは早送り＝次までの繰り返し）。
//
// 設定（T59）: 想定のボタンの前に畳んだ「設定」。開くと参加者（担当一覧の人のチェック。既定は全員）・職員（既定は想定の表の値）・夜間発災。
// 閉じたまま・何も変えずに想定を押せば、送る物は前と同じ { scenario } だけ（選んだ物だけ options に入れる）。
// 開く・閉じるは details を使わずボタン（既定の黒い▼を出さない）。選んだ印はチェックの印だけで、下地を敷かない。
//
// T70: 参加者のうち、本人も家族・支援者もスマホで赤緑を押せない人に「押せる人なし」（灰の文字。名前は本人のページへ。スマホを入れるのはそこ）。
// 押せる人のいない人は本人役（AI）が呼ばれず、表の行が当たったときだけ表の固定の安否が届く。
// 想定のボタンの下に、選んだ参加者での AI の呼び出しの見込み（lib/drill/estimate.ts）。見込みが残りを超える想定には
// 「上限不足」（赤の文字）。開始は止めない（途中で当たれば訓練の画面に「AI 停止」の帯）。
// T76: 見込みの行の頭に AI の今の状態（lib/claude/status.ts。「AI 本日残り 37 / 200 回」）を並べ、足りるかを 1 行で見られるようにする
// （T70 の案 6 の「重ねない」から変えた）。AI が使えない（未設定）ときは回数でなく想定ごとの進み方（固定の筋は「想定のみ」、仮想は「世界停止」）。
// 未設定の印は中立の地の印（components/ui/AiStatus。状態の 4 色を使わない）。開始は止めない
// T90: 大雨想定・地震想定・仮想は連続の時計（30 分・1 時間・3 時間・次まで）で始める（選ばせない）。送る物の options に clock を足し、
// 見込みは連続の時計の式（lib/drill/estimate.ts の estimateClockCalls）
// T104: 設定に「仮想規模」（既定おまかせ。仮想だけに効く。lib/drill/scale.ts）と「自宅」（既定 事業所付近。大雨想定・地震想定の監督が
// 訓練する人の身の回りの出来事に使う。lib/drill/self.ts）。どちらも既定のままなら送る物は前と同じ

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { DrillScenario } from "@/lib/db/types";
import { Button } from "@/components/ui/Button";
import { CHOICE_INPUT } from "@/components/ui/choice";
import { OpenIcon, PlayIcon } from "@/components/ui/Icon";
import { LABEL } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { AiStatusMark } from "@/components/ui/AiStatus";
import { aiRemaining, aiUsable, type AiStatus } from "@/lib/claude/status";
import { CLOCK_LABELS, CLOCK_STEP_LABELS, CLOCK_STEPS } from "@/lib/drill/clock";
import { estimateClockCalls, overLimit } from "@/lib/drill/estimate";
import { AI_STOP_UI, DRILL_LABELS, SCENARIO_LABELS, T124_LABELS, T59_LABELS, T70_LABELS } from "@/lib/drill/labels";
import { isVirtual } from "@/lib/drill/scenarios";
import { STAFF_MAX, T104_LABELS } from "@/lib/drill/options";
import { SCALE_CHOICES, scaleKey, scaleLabel, scaleOfKey, type DrillScale } from "@/lib/drill/scale";

/** 進め方（訓練の画面の DrillControls と同じ並び。最後の次までが主の操作） */
const PACES: ReadonlyArray<string> = [CLOCK_LABELS.acts, ...CLOCK_STEPS.map((m) => CLOCK_STEP_LABELS[m]), CLOCK_LABELS.next];

/**
 * 開始の POST の中身（T124）。どの想定も連続の時計（T90）と、時間と状況で変わる手（T110）で始める。
 * chosen は設定で選んだ物だけ（何も変えなければ undefined）。clock と terms は設定の「変更あり」の印には数えない
 */
export function startBody(scenario: DrillScenario, chosen?: Record<string, unknown>): { scenario: DrillScenario; options: Record<string, unknown> } {
  return { scenario, options: { ...(chosen ?? {}), clock: true, terms: true } };
}

/**
 * 担当一覧の人（参加者の選択）。canPress が false の人に「押せる人なし」（無ければ印なし）、callable は本人役を呼びうる想定
 * （見込みに使う。無ければ全部の想定で数える）
 */
export type StartPerson = { id: string; name: string; canPress?: boolean; callable?: ReadonlyArray<DrillScenario> };

const SELECT =
  "h-8 min-w-0 rounded bg-panel px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** チェックの行。押したときは灰色だけ（data-press）。375px でも押せる高さ */
const CHECK_ROW = "flex min-h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded px-1.5 text-sm";
/** チェックは事業所と同じ 18px（T79 の CHOICE_INPUT。T80） */
const CHECK = CHOICE_INPUT;
/** 押せる人なしの人の名前（本人のページへ。下線の文字、押したときは灰色だけ） */
const NAME_LINK =
  "min-w-0 truncate rounded px-0.5 underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function StartButtons({
  scenarios,
  disabled,
  people = [],
  ai = null,
  towns = [],
}: {
  scenarios: ReadonlyArray<DrillScenario>;
  disabled: boolean;
  /** 担当一覧の人（参加者の選択。無ければ設定の参加者を出さない） */
  people?: ReadonlyArray<StartPerson>;
  /** AI の今の状態（lib/claude/status.ts。app/drill/page.tsx が lib/claude/cloudflare.ts の aiStatusFor で読む）。読めなければ null */
  ai?: AiStatus | null;
  /** 訓練する人の住む所に選べる地区（T104、lib/drill/self.ts の homeTowns）。無ければ自宅の欄を出さない */
  towns?: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<DrillScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(people.map((p) => p.id)));
  const [staff, setStaff] = useState("");
  const [night, setNight] = useState(false);
  // T104: 仮想の規模（空はおまかせ）と自宅の地区（空は事業所付近）
  const [scale, setScale] = useState("");
  const [home, setHome] = useState("");
  const boxId = useId();

  const all = chosen.size === people.length;
  const none = people.length > 0 && chosen.size === 0;
  const picked = people.filter((p) => chosen.has(p.id));
  // 押せる人なし（選んだ参加者のうち）
  const noPresser = picked.filter((p) => p.canPress === false).length;
  // 主の操作の色は先頭の想定（SCENARIO_ORDER の大雨想定）だけ
  const main = scenarios[0] ?? null;

  /** 選んだ物だけ（何も変えなければ undefined。送る物は前と同じ） */
  const options = () => {
    const o: { participants?: string[]; staff?: number; night?: boolean; scale?: DrillScale; home?: string } = {};
    if (!all) o.participants = people.filter((p) => chosen.has(p.id)).map((p) => p.id);
    if (staff !== "") o.staff = Number(staff);
    if (night) o.night = true;
    const s = scale !== "" ? scaleOfKey(scale) : null;
    if (s) o.scale = s;
    if (home !== "") o.home = home;
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
      const res = await fetch("/api/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startBody(scenario, options())),
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
  // 見込みと比べる今日の残り（未設定は 0。読めなければ比べない）と、AI が使えるか
  const remaining = ai ? aiRemaining(ai) : null;
  const usable = ai === null || aiUsable(ai);
  const estimates = people.length > 0 && !none;

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
        {changed && !open && (
          <span className="text-xs font-normal text-muted">{settingsSummary(people.length, chosen.size, staff, night, scale, home)}</span>
        )}
      </Button>
      {scenarios.map((s) => (
        <Button
          key={s}
          kind={s === main ? "main" : "plain"}
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
      {/* T124: 進め方（訓練の画面と同じ並び。主の次までと、通しの早送りを本文色で） */}
      <p className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted" data-start-pace>
        <span>
          {T124_LABELS.pace} {PACES.slice(0, -1).join("・")}・<span className="font-bold text-ink">{CLOCK_LABELS.next}</span>
        </span>
        <span>
          {T124_LABELS.through} <span className="font-bold text-ink">{DRILL_LABELS.fastForward}</span>
        </span>
      </p>
      {(estimates || (ai !== null && !(ai.kind === "ready" && ai.remaining === null))) && (
        <p className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted tabular-nums" data-estimate>
          {/* 今日の残り（か未設定）を見込みの頭に並べる（T76） */}
          {ai && <AiStatusMark status={ai} />}
          {estimates && usable && <span>{T70_LABELS.estimate}</span>}
          {estimates &&
            scenarios.map((s) => {
              const n = estimateClockCalls(s, picked);
              const over = overLimit(n, remaining);
              const effect = isVirtual(s) ? AI_STOP_UI.virtual : AI_STOP_UI.fixed;
              const effectTitle = isVirtual(s) ? AI_STOP_UI.virtualTitle : AI_STOP_UI.fixedTitle;
              // AI が使えない: 回数でなく、その想定の進み方（固定の筋は想定のみ、仮想は世界停止）。色は付けない
              if (!usable)
                return (
                  <span key={s} data-estimate-scenario={s} data-ai-effect={isVirtual(s) ? "virtual" : "fixed"}>
                    {SCENARIO_LABELS[s]}{" "}
                    <span className="font-bold text-ink" title={effectTitle}>
                      {effect}
                    </span>
                  </span>
                );
              return (
                <span key={s} data-estimate-scenario={s} data-estimate-calls={n} data-over={over ? "" : undefined}>
                  {SCENARIO_LABELS[s]} {T70_LABELS.about} {n} {T70_LABELS.times}
                  {over && (
                    <span className="ml-1 font-bold text-danger" title={`${AI_STOP_UI.title} 途中から ${effect}`}>
                      {T70_LABELS.short}
                    </span>
                  )}
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
            {/* T104: 仮想の規模（おまかせは開始の時に幅の中から決まる）と、訓練する人の自宅の地区 */}
            <label className="flex items-center gap-1.5 text-sm">
              <span className={LABEL}>{T104_LABELS.scale}</span>
              <Select value={scale} onChange={(e) => setScale(e.target.value)} className={SELECT} aria-label={T104_LABELS.scale} data-start-scale>
                <option value="">{T104_LABELS.scaleAuto}</option>
                {SCALE_CHOICES.map((s) => (
                  <option key={scaleKey(s)} value={scaleKey(s)}>
                    {scaleLabel(s)}
                  </option>
                ))}
              </Select>
            </label>
            {towns.length > 0 && (
              <label className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className={LABEL}>{T104_LABELS.home}</span>
                <Select value={home} onChange={(e) => setHome(e.target.value)} className={SELECT} aria-label={T104_LABELS.home} data-start-home>
                  <option value="">{T104_LABELS.homeNear}</option>
                  {towns.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 閉じた設定に添える選んだ物（「3 人・職員 1・夜間・地震 震度 6強・自宅 みずほし町」） */
function settingsSummary(total: number, chosen: number, staff: string, night: boolean, scale = "", home = ""): string {
  const s = scale !== "" ? scaleOfKey(scale) : null;
  return [
    chosen !== total ? `${chosen} ${T59_LABELS.people}` : null,
    staff !== "" ? `${T59_LABELS.staff} ${staff}` : null,
    night ? T59_LABELS.night : null,
    s ? scaleLabel(s) : null,
    home !== "" ? `${T104_LABELS.home} ${home}` : null,
  ]
    .filter(Boolean)
    .join("・");
}
