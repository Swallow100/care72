// 訓練の右の「被害状況」（docs/tasks/T17.md。世界の状態は監督 T19 が持つ）。見ている時刻の世界をそのまま並べる。
// 大雨は警戒レベル・浸水、地震は震度・津波。どちらも停電・電話・断水・道路・避難所・施設。
// 止まっている物（停電中・不通・断水・通行止・休止・満員）は要確認の色の文字。面は塗らない。

import type { DrillKind, WorldState } from "@/lib/drill/scenarios";
import {
  DRILL_LABELS,
  PHONE_LABELS,
  SHELTER_LABELS,
  TSUNAMI_LABELS,
  WATER_LABELS,
  WORLD_LABELS,
} from "@/lib/drill/labels";

const BAD = "font-bold text-state-check";

export function DamagePanel({
  kind,
  world,
  now,
  names,
}: {
  kind: DrillKind;
  world: WorldState;
  /** 見ている時刻（発災からの時間） */
  now: number;
  names: Readonly<Record<string, string>>;
}) {
  const o = world.outage;
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
          </Item>
          <Item label={WORLD_LABELS.flood} k="flood">
            {world.flood ? <span className={BAD}>{WORLD_LABELS.yes}</span> : <span className="text-muted">{WORLD_LABELS.no}</span>}
          </Item>
        </>
      ) : (
        <>
          <Item label={WORLD_LABELS.quake} k="quake">
            {world.quake ? <span className={BAD}>{world.quake}</span> : <span className="text-muted">{WORLD_LABELS.no}</span>}
          </Item>
          <Item label={WORLD_LABELS.tsunami} k="tsunami">
            <span className={world.tsunami === "evacuate" ? BAD : "text-muted"}>{TSUNAMI_LABELS[world.tsunami]}</span>
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
              {o.since}〜{o.restoredAt} {DRILL_LABELS.hours}
            </span>
          </span>
        ) : (
          <span>
            <span className={BAD}>{WORLD_LABELS.outageNow}</span>
            <span className="ml-1.5 tabular-nums">
              {now - o.since} {DRILL_LABELS.hours}
            </span>
            <span className="ml-1.5 text-xs text-muted">{o.area.scope === "office" ? WORLD_LABELS.office : WORLD_LABELS.area}</span>
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
    </dl>
  );
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
