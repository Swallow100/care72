// 訓練の右の「被害状況」（docs/tasks/T17.md。世界の状態は監督 T19 が持つ）。見ている時刻の世界をそのまま並べる。
// 大雨は警戒レベル・浸水、地震は震度・津波。どちらも停電・電話・断水・道路・避難所・施設・職員の空き・本人ごとの印（監督の差し込み）。
// 止まっている物（停電中・通話不可・断水・通行止・休止・満員）は要確認の色の文字。面は塗らない。
// 予定の出来事・向かっている人・届いた物（T92。監督の見込み・業者の巡回・ケアマネの手配）は灰の文字で、あるときだけ行を出す。
// T105: 訓練の途中（hidePrivate）は、本人に起きたこと（個別の印のうち非公表の物・本人の付いた予定・監督と世界の巡回）を出さない。
// 公表かは経過のタブと同じ表（lib/drill/timeline.ts の MARK_REACH・scheduledPublic・arrivalPublic）。終わった訓練は全部出す。
// T128: 区域の出来事（津波の避難・警戒レベル・浸水・停電の地区）は、行に対象を添える（「対象 3 人 伊藤・田中・加藤 事業所 対象外」。
// 決まりは lib/drill/area-targets.ts）。人を押すと左の表のその人の行へ（#row-<id>）。事業所が分からなければ事業所の部分を出さない。

import { ARRIVAL_ROLE_LABELS, DAMAGE_EXTRA_LABELS, SUPPLY_LABELS } from "@/lib/drill/event-catalog";
import type { DrillKind, PersonMarks, SupplyKind, WorldChange, WorldState } from "@/lib/drill/scenarios";
import {
  clockLabel,
  MARK_LABELS,
  PHONE_LABELS,
  SHELTER_LABELS,
  TSUNAMI_LABELS,
  WATER_LABELS,
  WORLD_LABELS,
} from "@/lib/drill/labels";
import { hourSpanText, hourText } from "@/lib/drill/time-text";
import { arrivalPublic, MARK_REACH, scheduledPublic } from "@/lib/drill/timeline";
import { areaTargetOf, familyName, TARGET_LABELS, type AreaPerson, type AreaTarget } from "@/lib/drill/area-targets";

const BAD = "font-bold tone-check";

export function DamagePanel({
  kind,
  world,
  now,
  names,
  hidePrivate = false,
  people,
}: {
  kind: DrillKind;
  world: WorldState;
  /** 見ている時刻（発災からの時間） */
  now: number;
  names: Readonly<Record<string, string>>;
  /** 訓練の途中は本人に起きたこと（非公表）を出さない（T105） */
  hidePrivate?: boolean;
  /** 参加者の台帳のハザードと町（T128。区域の出来事の対象）。無ければ対象を出さない */
  people?: ReadonlyArray<AreaPerson>;
}) {
  const o = world.outage;
  const target = (c: WorldChange) => (people ? <Targets t={areaTargetOf(c, people)} names={names} total={people.length} /> : null);
  const scheduled = [...(world.scheduled ?? [])].filter((x) => !hidePrivate || scheduledPublic(x)).sort((a, b) => a.at - b.at);
  const coming = (world.arrivals ?? [])
    .filter((a) => !a.arrived && (!hidePrivate || arrivalPublic(a)))
    .sort((a, b) => a.arrive - b.arrive);
  const supplies = Object.entries(world.supplies ?? {}).flatMap(([person, got]) =>
    (Object.entries(got) as Array<[SupplyKind, number | undefined]>).flatMap(([k, at]) =>
      typeof at === "number" ? [{ id: `${person}-${k}`, label: names[person] ?? person, state: `${SUPPLY_LABELS[k]} ${clockLabel(at)}`, bad: false }] : [],
    ),
  );
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm" data-damage>
      {kind === "heavy_rain" ? (
        <>
          <Item label={WORLD_LABELS.alert} k="alert">
            {world.alertLevel === null ? (
              <span className="text-muted">{WORLD_LABELS.no}</span>
            ) : (
              <span className={world.alertLevel >= 4 ? BAD : "font-bold"}>{world.alertLevel}</span>
            )}
            {world.alertLevel !== null && target({ kind: "alert", level: world.alertLevel })}
          </Item>
          <Item label={WORLD_LABELS.flood} k="flood">
            {world.flood ? <span className={BAD}>{WORLD_LABELS.yes}</span> : <span className="text-muted">{WORLD_LABELS.no}</span>}
            {world.flood && target({ kind: "flood" })}
          </Item>
        </>
      ) : (
        <>
          <Item label={WORLD_LABELS.quake} k="quake">
            {world.quake ? <span className={BAD}>{world.quake}</span> : <span className="text-muted">{WORLD_LABELS.no}</span>}
          </Item>
          <Item label={WORLD_LABELS.tsunami} k="tsunami">
            <span className={world.tsunami === "evacuate" ? BAD : "text-muted"}>{TSUNAMI_LABELS[world.tsunami]}</span>
            {world.tsunami === "evacuate" && target({ kind: "tsunami", state: "evacuate" })}
          </Item>
        </>
      )}
      <Item label={WORLD_LABELS.outage} k="outage">
        {!o ? (
          <span className="text-muted">{WORLD_LABELS.no}</span>
        ) : o.restoredAt !== null ? (
          <span>
            {WORLD_LABELS.restored}
            <span className="ml-1.5 text-xs text-muted tabular-nums">
              {hourSpanText(o.since, o.restoredAt)}
            </span>
          </span>
        ) : (
          <span>
            <span className={BAD}>{WORLD_LABELS.outageNow}</span>
            <span className="ml-1.5 tabular-nums">
              {hourText(now - o.since)}
            </span>
            <span className="ml-1.5 text-xs text-muted">{o.area.scope === "office" ? WORLD_LABELS.office : o.area.scope === "towns" ? o.area.towns.join("・") : WORLD_LABELS.area}</span>
            {target({ kind: "outage", area: o.area })}
          </span>
        )}
      </Item>
      <Item label={WORLD_LABELS.phone} k="phone">
        <span className={world.phone === "ok" ? "" : BAD}>{PHONE_LABELS[world.phone]}</span>
      </Item>
      <Item label={WORLD_LABELS.water} k="water">
        <span className={world.water === "out" ? BAD : world.water === "none" ? "text-muted" : ""}>{WATER_LABELS[world.water]}</span>
      </Item>
      <Item label={WORLD_LABELS.roads} k="roads">
        <List
          items={world.roads.map((r) => ({
            id: r.id,
            label: r.label,
            state: r.open ? WORLD_LABELS.open : WORLD_LABELS.closed,
            bad: !r.open,
            who: r.person ? names[r.person] : undefined,
          }))}
        />
      </Item>
      <Item label={WORLD_LABELS.shelters} k="shelters">
        <List
          items={world.shelters.map((s) => ({
            id: s.id,
            label: s.label,
            state: SHELTER_LABELS[s.state],
            bad: s.state !== "open",
            who: s.person ? names[s.person] : undefined,
          }))}
        />
      </Item>
      <Item label={WORLD_LABELS.facilities} k="facilities">
        <List
          items={world.facilities.map((f) => ({
            id: f.id,
            label: f.label,
            state: f.open ? WORLD_LABELS.running : WORLD_LABELS.stopped,
            bad: !f.open,
            who: f.person ? names[f.person] : undefined,
          }))}
        />
      </Item>
      <Item label={WORLD_LABELS.staff} k="staff">
        <span className={world.staff > 0 ? "tabular-nums" : `${BAD} tabular-nums`}>
          {WORLD_LABELS.staffFree} {world.staff} {WORLD_LABELS.people}
        </span>
      </Item>
      <Item label={WORLD_LABELS.marks} k="marks">
        <List
          items={Object.entries(world.marks ?? {}).flatMap(([person, m]) =>
            (Object.keys(MARK_LABELS) as Array<keyof PersonMarks>)
              .filter((k) => m[k] !== undefined && (!hidePrivate || MARK_REACH[k] === "public"))
              .map((k) => ({ id: `${person}-${k}`, label: names[person] ?? person, state: MARK_LABELS[k], bad: true })),
          )}
        />
      </Item>
      {/* T92: 予定の出来事・向かっている人・届いた物。無ければ行を出さない（前からの訓練の欄は同じ） */}
      {scheduled.length > 0 && (
        <Item label={DAMAGE_EXTRA_LABELS.scheduled} k="scheduled">
          <List
            items={scheduled.map((x, i) => ({
              id: `s${i}`,
              label: x.text,
              state: laterLabel(x.at, now),
              bad: false,
              who: x.person ? names[x.person] : undefined,
            }))}
          />
        </Item>
      )}
      {coming.length > 0 && (
        <Item label={DAMAGE_EXTRA_LABELS.arrivals} k="arrivals">
          <List
            items={coming.map((a, i) => ({
              id: `a${i}`,
              label: ARRIVAL_ROLE_LABELS[a.role],
              state: laterLabel(a.arrive, now),
              bad: false,
              who: names[a.person] ?? a.person,
            }))}
          />
        </Item>
      )}
      {supplies.length > 0 && (
        <Item label={DAMAGE_EXTRA_LABELS.supplies} k="supplies">
          <List items={supplies} />
        </Item>
      )}
    </dl>
  );
}

/**
 * 区域の対象（T128）。「対象 3 人 伊藤・田中・加藤 事業所 対象外」。人は押すと左の表のその人の行へ。多いときは 3 人と「他 N 人」、
 * 参加者の全員なら「全員」。事業所が分からなければ事業所を出さない
 */
function Targets({ t, names, total }: { t: AreaTarget | null; names: Readonly<Record<string, string>>; total: number }) {
  if (!t) return null;
  const n = t.persons.length;
  const all = n > 0 && n === total && total > 3;
  const max = 3;
  return (
    <span className="ml-1.5 inline-flex flex-wrap items-baseline gap-x-1 text-xs" data-targets={n} data-targets-office={t.office === null ? undefined : String(t.office)}>
      <span className="text-muted">{TARGET_LABELS.target}</span>
      <span className="font-bold tabular-nums">
        {n} {TARGET_LABELS.people}
      </span>
      {all ? (
        <span>{TARGET_LABELS.all}</span>
      ) : (
        t.persons.slice(0, max).map((p) => (
          <a key={p} href={`#row-${p}`} className="-mx-0.5 rounded px-0.5 underline decoration-muted underline-offset-2" data-press data-target-person={p}>
            {familyName(names[p] ?? p)}
          </a>
        ))
      )}
      {!all && n > max && (
        <span className="text-muted">
          {TARGET_LABELS.more} {n - max} {TARGET_LABELS.people}
        </span>
      )}
      {t.office !== null && (
        <span>
          <span className="text-muted">{TARGET_LABELS.office}</span> <span className="font-bold">{t.office ? TARGET_LABELS.officeIn : TARGET_LABELS.officeOut}</span>
        </span>
      )}
    </span>
  );
}

/** 予定・到着の時刻（見ている時刻より後なら「6 時間後」、過ぎていれば発災からの時刻） */
function laterLabel(minute: number, nowHour: number): string {
  const rest = minute - nowHour * 60;
  return rest > 0 ? `${clockLabel(rest)}${DAMAGE_EXTRA_LABELS.later}` : clockLabel(minute);
}

function Item({ label, k, children }: { label: string; k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs leading-5 text-muted">{label}</dt>
      <dd data-world={k}>{children}</dd>
    </>
  );
}

function List({ items }: { items: Array<{ id: string; label: string; state: string; bad: boolean; who?: string }> }) {
  if (items.length === 0) return <span className="text-muted">{WORLD_LABELS.no}</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((x) => (
        <li key={x.id} className="flex flex-wrap items-baseline gap-x-1.5">
          <span>{x.label}</span>
          <span className={x.bad ? BAD : "text-muted"}>{x.state}</span>
          {x.who && <span className="text-xs text-muted">{x.who}</span>}
        </li>
      ))}
    </ul>
  );
}
