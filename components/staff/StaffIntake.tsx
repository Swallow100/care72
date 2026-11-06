"use client";

// 受入の入口（/staff の上、docs/tasks/T23.md・T152.md）。受入一覧の最初に、避難所の欄（3 つに共通）と入り方の 3 つを並べる:
//   QR 読取（本人の 1 枚の裏の QR。端末のカメラ・URL の貼り付け・審査員は見本の QR）→ QR の頁（/q/<token>）の「受入」
//   氏名検索（氏名・カナ・生年月日、事業所をまたぐ）→ ヒットの行の「受入」
//   新規登録（台帳に無い人を最小の項目で）→「新規登録」で受入まで
// どれも受け入れたら受入一覧（?received=<受け持ちの id>）に戻り、その人の行が表の上に出る（components/staff/StaffTable.tsx）。
// 前の「避難所」の切替（既に誰かが受け入れた人を避難所で探す）は 3 つの後ろに「避難所別」で残す。
// 受け入れる避難所の既定は自分がいちばん最近に受け入れた所。QR の頁へは今の欄の値を渡す（?shelter=）。
// ヒットはカナ・生年月日・年齢だけ（サーバーが住所・電話・漢字の氏名を返さない）。受け入れて初めて本人のページを開ける。
// 検索の言葉は本文（JSON）で送り、URL に載せない。
// ヒットは選んでまとめて受け入れられる（一括受入、T172。避難所は上の欄の 1 回の入力、1 人ずつ今の受入を通す。lib/custody/bulk.ts）。
// 避難所の欄が空のまま受入・新規登録を押すと、送らずに欄へ送って焦点を置き、欄に注意の枠と「未入力」（T78）。
// 受入一覧が空のときの入口（components/staff/StaffTable）は入り方の最初のボタン（INTAKE_ENTRY_ID）へ送る。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";
import type { PersonHit } from "@/lib/custody/search";
import { ENTRY_KINDS, qrTokenFrom, type EntryKind } from "@/lib/custody/entry";
import { DEVICE_NAME_MAX, MED_MAX, NOTE_MAX, SHELTER_MAX } from "@/lib/custody/forms";
import { BULK_MAX, togglePick, togglePickAll, type BulkSent, type BulkTarget } from "@/lib/custody/bulk";
import { BULK_LABELS, CUSTODY_ERROR_LABELS, CUSTODY_LABELS, ENTRY_LABELS } from "@/lib/custody/labels";
import {
  CUSTODY_RECEIVE_API,
  CUSTODY_REGISTER_API,
  CUSTODY_SEARCH_API,
  CUSTODY_SHELTER_API,
  qrPagePath,
  receivedHref,
} from "@/lib/custody/paths";
import { DEVICE_KINDS, type DeviceKind } from "@/lib/db/types";
import { DEVICE_LABELS, INTAKE_LABELS } from "@/lib/labels";
import { KANA_MAX, NAME_MAX } from "@/lib/office/forms";
import { Button, ButtonLink } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon, NextIcon, QrIcon, SearchIcon, ShelterIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD } from "@/components/ui/table";
import { BulkButton, BulkCheck, BulkResult, useBulkRun } from "./BulkReceive";
import { QrCamera } from "./QrCamera";

type Tab = EntryKind | "shelter";

const ENTRY: Record<EntryKind, { icon: typeof QrIcon; label: string; sub: string }> = {
  qr: { icon: QrIcon, label: ENTRY_LABELS.qr, sub: ENTRY_LABELS.qrSub },
  search: { icon: SearchIcon, label: ENTRY_LABELS.search, sub: ENTRY_LABELS.searchSub },
  register: { icon: AddPersonIcon, label: ENTRY_LABELS.register, sub: ENTRY_LABELS.registerSub },
};

const INPUT =
  "w-full min-w-0 rounded-md bg-panel2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 流れの中の小さな見出し（欄の名前と同じ 12px の薄い本文色） */
const STEP = "text-xs font-bold text-muted";

/** 検索の結果の表の見出し（右の面は狭いので、見出しを詰める） */
const HIT_TH = "bg-panel2 px-2 py-1 text-left text-xs font-bold whitespace-nowrap text-muted";

type Json = { ok?: boolean; label?: string; hits?: PersonHit[]; more?: boolean; personId?: string; custodyId?: string };

/** 見本の QR（審査員の壁の中だけ。lib/custody/samples.ts）。qr は本人の 1 枚と同じ URL の点の並び（サーバーが作る） */
export type QrSampleView = { personId: string; kana: string; token: string; qr: { size: number; d: string } };

/** 入り方の最初のボタンの id（受入一覧が空のときの入口が焦点を送る。T78・T152） */
export const INTAKE_ENTRY_ID = "staff-intake-entry";
/** 受入の面の見出しの id */
export const INTAKE_TITLE_ID = "intake-title";

/** 避難所の欄が空のまま押したときに、欄へ送って印を付ける（StaffIntake が渡す） */
const ShelterMissing = createContext<() => void>(() => {});

async function post(url: string, body: unknown): Promise<Json> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return ((await res.json().catch(() => null)) as Json | null) ?? { ok: false, label: "送信失敗" };
  } catch {
    return { ok: false, label: "送信失敗" };
  }
}

export function StaffIntake({
  shelters,
  defaultShelter,
  samples = [],
  initialTab = null,
}: {
  shelters: Array<{ shelter: string; people: number }>;
  defaultShelter: string | null;
  samples?: QrSampleView[];
  /** 開いたときに開いている入り方（テストと絵のため。既定は閉じた形） */
  initialTab?: Tab | null;
}) {
  const [tab, setTab] = useState<Tab | null>(initialTab);
  const [shelter, setShelter] = useState(defaultShelter ?? "");
  // 空のまま受入・新規登録を押した（入れるまで欄に印）
  const [missing, setMissing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const flagged = missing && !shelter.trim();
  const markShelter = () => {
    setMissing(true);
    field.current?.scrollIntoView({ block: "center" });
    field.current?.focus({ preventScroll: true });
  };
  const pick = (t: Tab) => setTab((cur) => (cur === t ? null : t));
  return (
    <Panel aria-labelledby={INTAKE_TITLE_ID} data-intake>
      {/* 見出しと避難所の欄を 1 行に（欄の名前は欄の左） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PanelHead id={INTAKE_TITLE_ID} title={CUSTODY_LABELS.receive} />
        <label className="flex w-full max-w-sm min-w-0 items-center gap-2 text-sm">
          <span className="flex shrink-0 flex-col leading-tight">
            <span className="text-muted">{CUSTODY_LABELS.shelter}</span>
            {flagged && (
              <span className="text-xs font-bold tone-check" data-shelter-missing>
                {CUSTODY_LABELS.missing}
              </span>
            )}
          </span>
          <input
            ref={field}
            type="text"
            value={shelter}
            onChange={(e) => setShelter(e.target.value)}
            maxLength={SHELTER_MAX}
            list="staff-shelters"
            aria-invalid={flagged || undefined}
            // 焦点のある間も注意の枠のまま（焦点の枠の色に替えない）
            className={`${INPUT}${flagged ? " outline-2 outline-solid outline-state-check focus-visible:outline-state-check" : ""}`}
            data-field="shelter"
          />
          <datalist id="staff-shelters">
            {shelters.map((s) => (
              <option key={s.shelter} value={s.shelter} />
            ))}
          </datalist>
        </label>
      </div>

      {/* 入り方の 3 つ。選んだ物は操作の色の枠（選択の印。薄い下地は敷かない） */}
      {/* 前の「避難所」の切替（避難所別）は 3 つの後ろに小さく、同じ行の右の端に */}
      <div role="group" aria-label={CUSTODY_LABELS.receive} className="mt-3 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]" data-entries>
        {ENTRY_KINDS.map((k, i) => {
          const e = ENTRY[k];
          const on = tab === k;
          return (
            <button
              key={k}
              id={i === 0 ? INTAKE_ENTRY_ID : undefined}
              type="button"
              aria-pressed={on}
              aria-controls={on ? "intake-flow" : undefined}
              onClick={() => pick(k)}
              className={`flex min-h-14 items-center gap-3 rounded-lg bg-panel2 px-3 py-2 text-left outline-offset-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${on ? "outline-2 outline-solid outline-accent" : ""}`}
              data-press
              data-entry={k}
            >
              <e.icon aria-hidden className="size-6 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[0.9375rem] leading-6 font-bold">{e.label}</span>
                <span className="block text-xs text-muted">{e.sub}</span>
              </span>
            </button>
          );
        })}
        <Button
          kind="quiet"
          size="sm"
          icon={ShelterIcon}
          aria-pressed={tab === "shelter"}
          aria-controls={tab === "shelter" ? "intake-flow" : undefined}
          onClick={() => pick("shelter")}
          className={`self-center justify-self-end ${tab === "shelter" ? "underline decoration-2 underline-offset-4" : "font-normal text-muted"}`}
          data-entry="shelter"
        >
          {ENTRY_LABELS.shelterList}
        </Button>
      </div>

      {tab && (
        <div id="intake-flow" className="mt-3" data-flow={tab}>
          <ShelterMissing value={markShelter}>
            {tab === "qr" && <QrPanel shelter={shelter} samples={samples} />}
            {tab === "search" && <SearchPanel shelter={shelter} />}
            {tab === "shelter" && <ShelterPanel shelter={shelter} shelters={shelters} />}
            {tab === "register" && <RegisterPanel shelter={shelter} />}
          </ShelterMissing>
        </div>
      )}
    </Panel>
  );
}

/**
 * QR 読取。端末のカメラ（アプリの中で読める端末だけ）・読んだ URL の貼り付け・見本の QR（審査員の壁の中だけ）の
 * どれからも、トークンを取り出して QR の頁へ移る。受入はその頁で（同意の無い人は要約を出さず「同意なし」「未確認」のまま）
 */
function QrPanel({ shelter, samples }: { shelter: string; samples: QrSampleView[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const go = (token: string) => router.push(qrPagePath(token, shelter.trim() || null));

  function open(e: React.FormEvent) {
    e.preventDefault();
    const token = qrTokenFrom(text);
    if (!token) return setBad(true);
    setBad(false);
    go(token);
  }

  return (
    <div className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
      <div className="space-y-3">
        <section className="space-y-1">
          <h3 className={STEP}>{ENTRY_LABELS.camera}</h3>
          <QrCamera onToken={go} />
        </section>
        <form onSubmit={open} className="space-y-1" data-form="qr-url">
          <label htmlFor="intake-qr-url" className={`block ${STEP}`}>
            {ENTRY_LABELS.url}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="intake-qr-url"
              type="url"
              inputMode="url"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setBad(false);
              }}
              autoComplete="off"
              aria-invalid={bad || undefined}
              className={`${INPUT} tabular-nums`}
            />
            <Button type="submit" icon={NextIcon} disabled={!text.trim()}>
              {ENTRY_LABELS.open}
            </Button>
          </div>
          {bad && (
            <p role="alert" className="text-xs font-bold text-danger">
              {ENTRY_LABELS.urlBad}
            </p>
          )}
        </form>
      </div>
      {samples.length > 0 && (
        <section className="space-y-1" data-samples={samples.length}>
          <h3 className={STEP}>{ENTRY_LABELS.sample}</h3>
          <ul className="space-y-1.5">
            {samples.map((s) => {
              const open = shown === s.personId;
              return (
                <li key={s.personId} className="rounded-md bg-panel2 px-2 py-1.5" data-sample={s.personId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-bold">{s.kana}</span>
                    <Button size="sm" kind="plainIn" icon={open ? CloseIcon : QrIcon} onClick={() => setShown(open ? null : s.personId)} aria-expanded={open}>
                      {open ? ENTRY_LABELS.hideQr : ENTRY_LABELS.showQr}
                    </Button>
                    <ButtonLink href={qrPagePath(s.token, shelter.trim() || null)} size="sm" kind="main" icon={NextIcon} data-sample-open>
                      {ENTRY_LABELS.open}
                    </ButtonLink>
                  </div>
                  {/* ほかの端末のカメラで読む用（白地に黒。ライト・ダークで反転させない） */}
                  {open && (
                    <svg
                      viewBox={`0 0 ${s.qr.size} ${s.qr.size}`}
                      className="mt-1.5 size-40 rounded bg-white"
                      role="img"
                      aria-label={`${ENTRY_LABELS.sample} ${s.kana}`}
                      shapeRendering="crispEdges"
                      data-sample-qr
                    >
                      <path d={s.qr.d} fill="#000" />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SearchPanel({ shelter }: { shelter: string }) {
  const [text, setText] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hits: PersonHit[]; more: boolean } | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const data = await post(CUSTODY_SEARCH_API, { text, birth });
    setBusy(false);
    if (data.ok && data.hits) setResult({ hits: data.hits, more: data.more === true });
    else {
      setResult(null);
      setError(data.label ?? "送信失敗");
    }
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={search} className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2 text-sm" data-form="search">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted">{CUSTODY_LABELS.nameKana}</span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="off"
            autoFocus
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted">{CUSTODY_LABELS.birth}</span>
          <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className={`${INPUT} tabular-nums`} />
        </label>
        <div className="col-span-2 flex items-center gap-3">
          <Button type="submit" kind="main" icon={SearchIcon} disabled={busy} data-pending={busy ? "" : undefined}>
            {busy ? CUSTODY_LABELS.sending : CUSTODY_LABELS.search}
          </Button>
          {error && (
            <span role="alert" className="font-bold text-danger">
              {error}
            </span>
          )}
        </div>
      </form>
      {result && <Hits key={result.hits.map((h) => h.id).join()} hits={result.hits} more={result.more} shelter={shelter} via="search" />}
    </div>
  );
}

function ShelterPanel({ shelter, shelters }: { shelter: string; shelters: Array<{ shelter: string; people: number }> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<PersonHit[] | null>(null);

  async function load(name: string) {
    setPicked(name);
    setBusy(true);
    setError(null);
    const data = await post(CUSTODY_SHELTER_API, { shelter: name });
    setBusy(false);
    if (data.ok && data.hits) setHits(data.hits);
    else {
      setHits(null);
      setError(data.label ?? "送信失敗");
    }
  }

  return (
    <div className="max-w-2xl text-sm">
      {shelters.length === 0 ? (
        <p className="text-muted">{CUSTODY_LABELS.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-1" data-list="shelters">
          {shelters.map((s) => (
            <li key={s.shelter}>
              <button
                type="button"
                onClick={() => load(s.shelter)}
                aria-pressed={picked === s.shelter}
                className={`rounded-md bg-panel2 px-2 py-1 ${picked === s.shelter ? "font-bold underline underline-offset-4" : ""}`}
                data-press
              >
                {s.shelter} <span className="tabular-nums text-muted">{s.people}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="mt-2 text-muted">{CUSTODY_LABELS.sending}</p>}
      {error && (
        <p role="alert" className="mt-2 font-bold text-danger">
          {error}
        </p>
      )}
      {hits && picked && <Hits key={picked} hits={hits} more={false} shelter={shelter || picked} via="shelter" />}
    </div>
  );
}

/**
 * ヒットの表。カナ・生年月日・年齢と「受入」（受入済は「開く」）。受け入れたら受入一覧へ（その人の行が上に出る）。
 * 選ぶ欄で何人かを選び「一括受入」（T172）。出ているヒットの中だけで選ぶ（新しい人を引かない）。失敗した人は選んだまま理由を出す
 */
function Hits({ hits, more, shelter, via }: { hits: PersonHit[]; more: boolean; shelter: string; via: "search" | "shelter" }) {
  const router = useRouter();
  const markShelter = useContext(ShelterMissing);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bulk = useBulkRun();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // 一括受入で受け入れた人（このヒットの表では受入済と同じに）
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const open = hits.filter((h) => !h.mine && !taken.has(h.id));
  const chosen = open.filter((h) => picked.has(h.id));
  const live = new Set(chosen.map((h) => h.id));
  const full = live.size >= BULK_MAX;
  const locked = busyId !== null || bulk.busy;

  async function receiveAll() {
    // 避難所が空なら送らずに欄へ（1 人の受入と同じ）
    if (!shelter.trim()) {
      markShelter();
      return;
    }
    setError(null);
    const send = async (t: BulkTarget): Promise<BulkSent> => {
      const data = await post(CUSTODY_RECEIVE_API, { personId: t.id, shelter, via });
      return data.ok && data.custodyId ? { ok: true, custodyId: data.custodyId } : { ok: false, label: data.label ?? "送信失敗" };
    };
    const out = await bulk.run(
      chosen.map((h) => ({ id: h.id, kana: h.kana })),
      send,
    );
    setTaken((t) => new Set([...t, ...out.flatMap((o) => (o.ok ? [o.id] : []))]));
    setPicked(new Set(out.flatMap((o) => (o.ok ? [] : [o.id]))));
  }

  async function receive(id: string) {
    // 避難所が空なら送らずに欄へ（欄に印。サーバーも「避難所 未入力」で断る）
    if (!shelter.trim()) {
      markShelter();
      return;
    }
    setBusyId(id);
    setError(null);
    const data = await post(CUSTODY_RECEIVE_API, { personId: id, shelter, via });
    if (data.ok && data.custodyId) {
      router.push(receivedHref(data.custodyId));
      return;
    }
    setBusyId(null);
    setError(data.label ?? "送信失敗");
  }

  if (hits.length === 0) return <p className="mt-2 text-sm text-muted">{CUSTODY_LABELS.noHits}</p>;
  return (
    <div className="mt-2">
      {error && (
        <p role="alert" className="mb-1 text-sm font-bold text-danger">
          {error}
        </p>
      )}
      <div className={TABLE_BOX}>
        <table className={TABLE} data-table="hits">
          <thead>
            <tr>
              <th className={`${HIT_TH} w-px`}>
                {open.length > 0 && (
                  <BulkCheck
                    label={BULK_LABELS.selectAll}
                    checked={chosen.length === open.length}
                    indeterminate={chosen.length > 0 && chosen.length < open.length}
                    disabled={locked}
                    onChange={() => setPicked(togglePickAll(live, open.map((h) => h.id)))}
                  />
                )}
              </th>
              <th className={HIT_TH}>{CUSTODY_LABELS.kana}</th>
              <th className={HIT_TH}>{CUSTODY_LABELS.birth}</th>
              <th className={HIT_TH}>{CUSTODY_LABELS.age}</th>
              <th className={HIT_TH}>
                <span className="sr-only">{CUSTODY_LABELS.receive}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} data-hit={h.id}>
                <td className={`${TD} w-px align-middle`}>
                  {!h.mine && !taken.has(h.id) && (
                    <BulkCheck
                      label={`${BULK_LABELS.select} ${h.kana}`}
                      checked={picked.has(h.id)}
                      disabled={locked || (full && !picked.has(h.id))}
                      onChange={() => setPicked(togglePick(live, h.id))}
                    />
                  )}
                </td>
                <td className={`${TD} font-bold`}>{h.kana}</td>
                <td className={`${TD} tabular-nums`}>{h.birthDate ?? "—"}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>
                  {h.age ?? "—"}
                  {h.ageReported && <span className="ml-1 text-xs text-muted">{CUSTODY_LABELS.reportedAge}</span>}
                </td>
                <td className={`${TD} w-px py-1 text-right`}>
                  {h.mine || taken.has(h.id) ? (
                    <Link href={`/people/${encodeURIComponent(h.id)}`} className="relative rounded px-1.5 py-0.5 font-bold whitespace-nowrap underline underline-offset-2" data-press>
                      {CUSTODY_LABELS.open}
                      <LinkPending />
                    </Link>
                  ) : (
                    // 行ごとの受入は流れの最後の 1 押しなので主の操作の色
                    <Button
                      size="sm"
                      kind="main"
                      icon={AddPersonIcon}
                      disabled={locked}
                      onClick={() => receive(h.id)}
                      data-pending={busyId === h.id ? "" : undefined}
                    >
                      {busyId === h.id ? CUSTODY_LABELS.sending : CUSTODY_LABELS.receive}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open.length > 0 && (
        <div className="mt-1.5" data-bulk="hits">
          <BulkButton count={chosen.length} bulk={bulk} onClick={receiveAll} />
        </div>
      )}
      <BulkResult outcomes={bulk.outcomes} />
      {!shelter.trim() && <p className="mt-1 text-xs font-bold tone-check">{CUSTODY_ERROR_LABELS.shelter}</p>}
      {more && <p className="mt-1 text-xs text-muted">{CUSTODY_LABELS.more}</p>}
    </div>
  );
}

/** 台帳に無い人をその場で登録する。氏名・カナ・年齢か生年月日・薬・機器（その他は名前。T64）・連絡先。登録で受入まで */
function RegisterPanel({ shelter }: { shelter: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [age, setAge] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [medications, setMedications] = useState("");
  const [devices, setDevices] = useState<DeviceKind[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [relation, setRelation] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const markShelter = useContext(ShelterMissing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // 避難所が空なら送らずに欄へ（欄に印）
    if (!shelter.trim()) {
      markShelter();
      return;
    }
    setBusy(true);
    setError(null);
    const data = await post(CUSTODY_REGISTER_API, {
      name,
      kana,
      age,
      birthDate,
      medications,
      // その他だけ名前を添える（ほかの種類はサーバーも名前を落とす）
      devices: devices.map((kind) => (kind === "other" ? { kind, detail: deviceName } : { kind })),
      contact: { relation, name: contactName, phone },
      shelter,
    });
    if (data.ok && data.custodyId) {
      router.push(receivedHref(data.custodyId));
      return;
    }
    setBusy(false);
    setError(data.label ?? "送信失敗");
  }

  const toggle = (d: DeviceKind) => setDevices((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  // その他を選んで名前が空なら送らない（名前が無いと何か分からない。サーバーも「機器名 未入力」で断る）
  const otherOn = devices.includes("other");
  const deviceNameMissing = otherOn && deviceName.trim() === "";

  return (
    <form onSubmit={submit} className="grid max-w-2xl grid-cols-2 gap-2 text-sm" data-form="register">
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.name}</span>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={INPUT} autoFocus data-field="name" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.kana}</span>
        <input type="text" required value={kana} onChange={(e) => setKana(e.target.value)} maxLength={KANA_MAX} className={INPUT} data-field="kana" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.age}</span>
        <input
          type="text"
          inputMode="numeric"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          maxLength={3}
          className={`${INPUT} tabular-nums`}
          data-field="age"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.birth}</span>
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={`${INPUT} tabular-nums`} />
      </label>
      <label className="col-span-2 flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.medications}</span>
        <textarea
          rows={2}
          value={medications}
          onChange={(e) => setMedications(e.target.value)}
          maxLength={MED_MAX * 10}
          className={`${INPUT} resize-y`}
          data-field="medications"
        />
      </label>
      <fieldset className="col-span-2">
        <legend className="text-muted">{CUSTODY_LABELS.devices}</legend>
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          {DEVICE_KINDS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-1">
              <input type="checkbox" checked={devices.includes(d)} onChange={() => toggle(d)} className="accent-accent" />
              {DEVICE_LABELS[d]}
            </label>
          ))}
        </div>
        {otherOn && (
          <label className="mt-1.5 flex flex-col gap-0.5">
            <span className="text-muted">{`${DEVICE_LABELS.other} ${INTAKE_LABELS.deviceName}`}</span>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              maxLength={DEVICE_NAME_MAX}
              required
              className={INPUT}
              data-field="device-name"
            />
          </label>
        )}
      </fieldset>
      <fieldset className="col-span-2 grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <legend className="col-span-3 text-muted">{CUSTODY_LABELS.contact}</legend>
        <input
          type="text"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          maxLength={20}
          placeholder={CUSTODY_LABELS.relation}
          aria-label={CUSTODY_LABELS.relation}
          className={INPUT}
        />
        <input
          type="text"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          maxLength={NOTE_MAX}
          placeholder={CUSTODY_LABELS.name}
          aria-label={`${CUSTODY_LABELS.contact} ${CUSTODY_LABELS.name}`}
          className={INPUT}
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          placeholder={CUSTODY_LABELS.phone}
          aria-label={CUSTODY_LABELS.phone}
          className={`${INPUT} tabular-nums`}
        />
      </fieldset>
      <div className="col-span-2 flex items-center gap-3">
        <Button
          type="submit"
          kind="main"
          icon={AddPersonIcon}
          disabled={busy || deviceNameMissing}
          data-pending={busy ? "" : undefined}
        >
          {busy ? CUSTODY_LABELS.sending : CUSTODY_LABELS.register}
        </Button>
        {!shelter.trim() && <span className="text-xs font-bold tone-check">{CUSTODY_ERROR_LABELS.shelter}</span>}
        {deviceNameMissing && <span className="text-xs font-bold tone-check">{CUSTODY_ERROR_LABELS.device}</span>}
        {error && (
          <span role="alert" className="font-bold text-danger">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
