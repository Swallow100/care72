"use client";

// 地域選択（T134）: 自治体の個別避難計画の様式の一覧（lib/forms/municipal-forms.ts）を、都道府県 → 市町村 → 様式と検索で選ぶ。
// 「取得」を押すと、サーバーが一覧の URL から公式の様式を取り、版のハッシュを確かめて返す（/api/forms/municipal/<id>/source）。
// 版が一覧と違えば「版違い」と「再読」（今の版を取り、読み取りからやり直す）。取れた物は様式追加の読取と同じ黒塗りの画面へ渡す
// （onPicked。PDF・Excel・Word は頁の絵に描いてから送る。T119）。旧形式・許諾要・内蔵（松山市）は押せず、理由の印。
// 共有済は、同じ版の対応表をほかの事業所が先に読んだ物（AI を呼ばずに写す）。取込済はこの事業所が前に作った対応表へ。
// 記載例・手引き・同意書は公式のリンクだけ。一覧に無い市は今どおり「読取」で自分のファイルを入れる。

import Link from "next/link";
import { useMemo, useState } from "react";
import { BTN_MAIN, INPUT } from "@/components/person/intake-ui";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { ExternalIcon, ReadIcon, RetryIcon, SearchIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { StateTag } from "@/components/ui/Tag";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import {
  allMunicipalEntries,
  availability,
  BLOCK_LABELS,
  FORMAT_LABELS,
  FORMAT_MIME,
  MUNICIPAL_CITIES,
  MUNICIPAL_LABELS as L,
  MUNICIPAL_SKIPPED,
  municipalFileName,
  municipalSourceHref,
  PREFECTURES,
  searchMunicipal,
  type MunicipalEntry,
} from "@/lib/forms/municipal-forms";

const SELECT =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const LINK = "-mx-0.5 rounded px-0.5 text-accent underline underline-offset-2";

export type MunicipalPickerProps = {
  /** 同じ版の共有の対応表がある様式の id */
  shared: readonly string[];
  /** この事業所が一覧の様式から作った対応表（様式の id → 対応表） */
  own: Readonly<Record<string, { id: string; status: "draft" | "checked" }>>;
  /** 事業所の市（offices.city）に当たる一覧の市の id */
  defaultCity: string | null;
  aiReady: boolean;
  /** 黒塗りの画面が開いている・読取中のあいだは押せない */
  busy: boolean;
  /** 取れたファイルを黒塗りの画面へ */
  onPicked: (file: File, municipalId: string) => void;
};

type RowState = { kind: "fetching" } | { kind: "version" } | { kind: "error"; label: string };

export function MunicipalPicker({ shared, own, defaultCity, aiReady, busy, onPicked }: MunicipalPickerProps) {
  const start = MUNICIPAL_CITIES.find((c) => c.id === defaultCity) ?? null;
  const [pref, setPref] = useState<string>(start?.pref ?? "");
  const [cityId, setCityId] = useState<string>(start?.id ?? "");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const sharedSet = useMemo(() => new Set(shared), [shared]);

  const prefCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of MUNICIPAL_CITIES) m.set(c.pref, (m.get(c.pref) ?? 0) + 1);
    return m;
  }, []);
  const cities = MUNICIPAL_CITIES.filter((c) => c.pref === pref);
  const city = cities.find((c) => c.id === cityId) ?? null;
  const skipped = MUNICIPAL_SKIPPED.filter((s) => s.pref === pref);
  const searching = query.trim() !== "";
  const entries: MunicipalEntry[] = searching ? searchMunicipal(query) : city ? allMunicipalEntries().filter((e) => e.city.id === city.id) : [];

  async function fetchForm(e: MunicipalEntry, accept: boolean) {
    const id = e.form.id;
    setRows((r) => ({ ...r, [id]: { kind: "fetching" } }));
    try {
      const res = await fetch(municipalSourceHref(id, accept));
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as { error?: string; label?: string } | null;
        setRows((r) => ({ ...r, [id]: j?.error === "version" ? { kind: "version" } : { kind: "error", label: j?.label ?? "取得失敗" } }));
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { label?: string } | null;
        setRows((r) => ({ ...r, [id]: { kind: "error", label: j?.label ?? "取得失敗" } }));
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], municipalFileName(e), { type: FORMAT_MIME[e.form.format] });
      setRows((r) => {
        const { [id]: _done, ...rest } = r;
        return rest;
      });
      onPicked(file, id);
    } catch {
      setRows((r) => ({ ...r, [id]: { kind: "error", label: "取得失敗" } }));
    }
  }

  return (
    <Panel aria-labelledby="municipal-title" data-municipal-picker>
      <PanelHead id="municipal-title" title={L.title} count={`${MUNICIPAL_CITIES.length} 市区・${allMunicipalEntries().length} 様式`} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          value={pref}
          onChange={(ev) => {
            setPref(ev.target.value);
            setCityId("");
          }}
          className={`${SELECT} w-40`}
          aria-label={L.pref}
          data-municipal-pref
        >
          <option value="" data-placeholder>
            {L.pref}
          </option>
          {PREFECTURES.map((p) => (
            <option key={p} value={p} data-sub={`${prefCounts.get(p) ?? 0} 市町村`}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={cityId} onChange={(ev) => setCityId(ev.target.value)} className={`${SELECT} w-44`} aria-label={L.city} disabled={!pref} data-municipal-city>
          <option value="" data-placeholder>
            {L.city}
          </option>
          {cities.map((c) => (
            <option key={c.id} value={c.id} data-sub={`${c.forms.length} 様式`}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="relative flex min-w-0 flex-1 items-center sm:max-w-80">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted" />
          <input
            className={`${INPUT} pl-7`}
            type="search"
            placeholder={L.search}
            aria-label={L.search}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            data-municipal-search
          />
        </label>
      </div>

      {entries.length > 0 ? (
        <div className={`mt-2 ${TABLE_BOX}`}>
          <table className={TABLE} data-municipal-table>
            <thead>
              <tr>
                <th className={TH}>{L.city}</th>
                <th className={TH}>{L.form}</th>
                <th className={TH}>{L.format}</th>
                <th className={`${TH} text-right`}>{L.pages}</th>
                <th className={TH}>{L.version}</th>
                <th className={TH}>{L.terms}</th>
                <th className={TH}>{L.state}</th>
                <th className={TH}>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const can = availability(e);
                const row = rows[e.form.id];
                const mine = own[e.form.id];
                const isShared = sharedSet.has(e.form.id);
                const needsAi = !isShared;
                return (
                  <tr key={e.form.id} data-municipal-form={e.form.id}>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="block text-xs text-muted">{e.city.pref}</span>
                      {e.city.name}
                    </td>
                    <td className={TD}>
                      <span className="block">{e.form.name}</span>
                      {e.form.note && <span className="block text-xs text-muted">{e.form.note}</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{FORMAT_LABELS[e.form.format]}</td>
                    <td className={`${TD} text-right tabular-nums`}>{e.form.pages ?? "—"}</td>
                    <td className={`${TD} text-xs`}>
                      <span className="block">{e.form.version || "—"}</span>
                      <span className="block text-muted tabular-nums">確認 {e.city.checkedAt}</span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`} title={e.city.terms.summary}>
                      {e.city.terms.flag}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {mine ? (
                        <Link href={`/forms/mapping/${encodeURIComponent(mine.id)}`} className={LINK} data-press data-municipal-own>
                          {L.imported}
                        </Link>
                      ) : can.ok ? (
                        <span className={isShared ? "" : "text-muted"} data-municipal-shared={isShared ? "1" : undefined}>
                          {isShared ? L.shared : L.aiRead}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <div className="flex items-center justify-end gap-2">
                        {!can.ok ? (
                          <span className="text-xs font-bold text-muted" data-municipal-block={can.reason}>
                            {BLOCK_LABELS[can.reason]}
                          </span>
                        ) : row?.kind === "version" ? (
                          <>
                            <StateTag tone="check">{L.versionChanged}</StateTag>
                            <button
                              type="button"
                              className={BTN_MAIN}
                              disabled={busy || !aiReady}
                              onClick={() => void fetchForm(e, true)}
                              data-press="overlay"
                              data-municipal-retry
                            >
                              <RetryIcon aria-hidden className="size-3.5 shrink-0" />
                              {L.retry}
                            </button>
                          </>
                        ) : (
                          <>
                            {row?.kind === "error" && (
                              <span role="alert" className="text-xs font-bold text-danger">
                                {row.label}
                              </span>
                            )}
                            <button
                              type="button"
                              className={BTN_MAIN}
                              disabled={busy || row?.kind === "fetching" || (needsAi && !aiReady)}
                              onClick={() => void fetchForm(e, false)}
                              data-press="overlay"
                              data-municipal-fetch
                            >
                              <ReadIcon aria-hidden className="size-3.5 shrink-0" />
                              {row?.kind === "fetching" ? L.fetching : L.fetch}
                            </button>
                          </>
                        )}
                        <a href={e.city.pageUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} inline-flex items-center gap-0.5 text-xs`} data-press>
                          {L.officialPage}
                          <ExternalIcon aria-hidden className="size-3" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        (searching || city) && <p className="mt-2 text-sm text-muted">{L.noHit}</p>
      )}

      {!searching && city && (
        <div className="mt-2 grid gap-1 text-xs" data-municipal-city-foot>
          {city.refs.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              {city.refs.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className={LINK} data-press data-municipal-ref={r.role}>
                  <span className="font-bold">{r.role}</span> {r.name}（{FORMAT_LABELS[r.format]}）
                </a>
              ))}
            </p>
          )}
          <p>
            <span className="font-bold">{L.terms}</span> {city.terms.flag}　<span className="text-muted">{city.terms.summary}</span>
            {city.terms.url && (
              <>
                {" "}
                <a href={city.terms.url} target="_blank" rel="noopener noreferrer" className={LINK} data-press>
                  著作権頁
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {!searching && skipped.length > 0 && (
        <ul className="mt-2 grid gap-0.5 text-xs" data-municipal-skipped>
          {skipped.map((s) => (
            <li key={s.city}>
              <span className="font-bold">{L.skipped}</span> {s.city} <span className="text-muted">{s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
