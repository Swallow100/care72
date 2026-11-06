// 仮想の訓練の「場所別」（T170）。世界の出来事を、どの実の場所で起きて誰に効くかが分かる形で並べる。
// 上に地域と川、次に区画ごとの地形とハザードと住む人（無い出来事の区画も出す。担当の人がどの区画かはコードが決める）、
// その下に橋・避難所・施設の出来事。止まっている物は被害状況の欄と同じ色の文字。面は塗らない。
// 出来事は訓練の想定（画面の上の 1 行）で、実の避難所の名前を使うときは地理院の出典と注意を出す。

import { familyName } from "@/lib/drill/area-targets";
import type { Area } from "@/lib/drill/area";
import { PLACE_LIST_LABELS } from "@/lib/drill/labels";
import { hourText } from "@/lib/drill/time-text";
import type { WorldPlace } from "@/lib/drill/world-marks";
import { SHELTER_CREDIT } from "@/lib/map/shelters";

const BAD = "font-bold tone-check";

export function PlaceList({
  area,
  places,
  residents,
  names,
}: {
  area: Area;
  places: ReadonlyArray<WorldPlace>;
  residents: Readonly<Record<string, string[]>>;
  names: Readonly<Record<string, string>>;
}) {
  const towns = new Set(area.towns.map((t) => t.town));
  const others = places.filter((p) => !towns.has(p.place));
  return (
    <div className="space-y-2 text-sm" data-place-list>
      {(area.region || area.rivers.length > 0) && (
        <p className="text-xs leading-5 text-muted" data-place-region>
          {area.region && (
            <span className="mr-2">
              {PLACE_LIST_LABELS.region} <span className="text-ink">{area.region}</span>
            </span>
          )}
          {area.rivers.length > 0 && (
            <span>
              {PLACE_LIST_LABELS.rivers} <span className="text-ink">{area.rivers.join("・")}</span>
            </span>
          )}
        </p>
      )}
      <ul className="space-y-1.5">
        {area.towns.flatMap((t) => {
          const who = residents[t.town] ?? [];
          const now = places.find((p) => p.place === t.town);
          if (who.length === 0 && !now) return [];
          return [
            <li key={t.town} data-place={t.town}>
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-bold">{t.town}</span>
                {now && <span className={BAD}>{now.words.join("・")}</span>}
                {now && <span className="text-xs text-muted tabular-nums">{hourText(now.hour)}</span>}
                {who.map((p) => (
                  <a key={p} href={`#row-${p}`} className="-mx-0.5 rounded px-0.5 text-xs underline decoration-muted underline-offset-2" data-press data-place-person={p}>
                    {familyName(names[p] ?? p)}
                  </a>
                ))}
              </div>
              <p className="text-xs leading-4 text-muted">
                {t.terrain}
                {t.hazardWords ? `。${t.hazardWords}` : ""}
              </p>
            </li>,
          ];
        })}
      </ul>
      {others.length > 0 && (
        <ul className="space-y-0.5" data-place-others>
          {others.map((p) => (
            <li key={p.place} className="flex flex-wrap items-baseline gap-x-1.5" data-place={p.place}>
              <span>{p.place}</span>
              <span className={BAD}>{p.words.join("・")}</span>
              <span className="text-xs text-muted tabular-nums">{hourText(p.hour)}</span>
            </li>
          ))}
        </ul>
      )}
      {area.realShelters && (
        <p className="text-[11px] leading-4 text-muted" data-place-credit>
          {PLACE_LIST_LABELS.shelterSource}{" "}
          <a href={SHELTER_CREDIT.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
            {SHELTER_CREDIT.text}
          </a>{" "}
          <a href={SHELTER_CREDIT.noticeHref} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
            {SHELTER_CREDIT.notice}
          </a>
        </p>
      )}
    </div>
  );
}
