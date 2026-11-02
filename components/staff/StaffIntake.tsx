"use client";

// 受入の入口（/staff の右の面、docs/tasks/T23.md）。3 つ: 検索（氏名・カナ・生年月日、事業所をまたぐ）・避難所（既に誰かが受け入れた人）・
// 新規登録（台帳に無い人を最小の項目で）。QR は本人の 1 枚の裏から /q/<token> を開き、その頁の「受入」から。
// 受け入れる避難所は上の 1 つの欄（既定は自分がいちばん最近に受け入れた所）。
// ヒットはカナ・生年月日・年齢だけ（サーバーが住所・電話・漢字の氏名を返さない）。受け入れて初めて本人のページを開ける。
// 検索の言葉は本文（JSON）で送り、URL に載せない。受け入れたら表を読み直す（router.refresh）。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PersonHit } from "@/lib/custody/search";
import { MED_MAX, NOTE_MAX, SHELTER_MAX } from "@/lib/custody/forms";
import { CUSTODY_ERROR_LABELS, CUSTODY_LABELS } from "@/lib/custody/labels";
import { CUSTODY_RECEIVE_API, CUSTODY_REGISTER_API, CUSTODY_SEARCH_API, CUSTODY_SHELTER_API } from "@/lib/custody/paths";
import { DEVICE_KINDS, type DeviceKind } from "@/lib/db/types";
import { DEVICE_LABELS } from "@/lib/labels";
import { KANA_MAX, NAME_MAX } from "@/lib/office/forms";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon, SearchIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD } from "@/components/ui/table";

const TABS = ["search", "shelter", "register"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  search: CUSTODY_LABELS.search,
  shelter: CUSTODY_LABELS.shelterList,
  register: CUSTODY_LABELS.register,
};

const INPUT =
  "w-full min-w-0 rounded-md bg-panel2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** 検索の結果の表の見出し（右の面は狭いので、見出しを詰める） */
const HIT_TH = "bg-panel2 px-2 py-1 text-left text-xs font-bold whitespace-nowrap text-muted";

type Json = { ok?: boolean; label?: string; hits?: PersonHit[]; more?: boolean; personId?: string };

async function post(url: string, body: unknown): Promise<Json> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return ((await res.json().catch(() => null)) as Json | null) ?? { ok: false, label: "送信失敗" };
  } catch {
    return { ok: false, label: "送信失敗" };
  }
}

export function StaffIntake({ shelters, defaultShelter }: { shelters: Array<{ shelter: string; people: number }>; defaultShelter: string | null }) {
  const [tab, setTab] = useState<Tab>("search");
  const [shelter, setShelter] = useState(defaultShelter ?? "");
  return (
    <Panel aria-labelledby="intake-title">
      <PanelHead id="intake-title" title={CUSTODY_LABELS.receive} />
      <label className="mt-2 flex flex-col gap-0.5 text-sm">
        <span className="text-muted">{CUSTODY_LABELS.shelter}</span>
        <input
          type="text"
          value={shelter}
          onChange={(e) => setShelter(e.target.value)}
          maxLength={SHELTER_MAX}
          list="staff-shelters"
          className={INPUT}
          data-field="shelter"
        />
        <datalist id="staff-shelters">
          {shelters.map((s) => (
            <option key={s.shelter} value={s.shelter} />
          ))}
        </datalist>
      </label>

      <div role="tablist" aria-label={CUSTODY_LABELS.receive} className="mt-3 flex gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 ${tab === t ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"}`}
            data-press
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="mt-2" role="tabpanel">
        {tab === "search" && <SearchPanel shelter={shelter} />}
        {tab === "shelter" && <ShelterPanel shelter={shelter} shelters={shelters} />}
        {tab === "register" && <RegisterPanel shelter={shelter} />}
      </div>
    </Panel>
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
    <div>
      <form onSubmit={search} className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2 text-sm" data-form="search">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted">{CUSTODY_LABELS.nameKana}</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} maxLength={NAME_MAX} autoComplete="off" className={INPUT} />
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
      {result && <Hits hits={result.hits} more={result.more} shelter={shelter} via="search" onReceived={() => search()} />}
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
    <div className="text-sm">
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
      {hits && picked && <Hits hits={hits} more={false} shelter={shelter || picked} via="shelter" onReceived={() => load(picked)} />}
    </div>
  );
}

/** ヒットの表。カナ・生年月日・年齢と「受入」（受入済は「開く」） */
function Hits({
  hits,
  more,
  shelter,
  via,
  onReceived,
}: {
  hits: PersonHit[];
  more: boolean;
  shelter: string;
  via: "search" | "shelter";
  onReceived: () => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function receive(id: string) {
    setBusyId(id);
    setError(null);
    const data = await post(CUSTODY_RECEIVE_API, { personId: id, shelter, via });
    setBusyId(null);
    if (data.ok) {
      router.refresh();
      onReceived();
    } else setError(data.label ?? "送信失敗");
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
                <td className={`${TD} font-bold`}>{h.kana}</td>
                <td className={`${TD} tabular-nums`}>{h.birthDate ?? "—"}</td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>
                  {h.age ?? "—"}
                  {h.ageReported && <span className="ml-1 text-xs text-muted">{CUSTODY_LABELS.reportedAge}</span>}
                </td>
                <td className={`${TD} w-px py-1 text-right`}>
                  {h.mine ? (
                    <Link href={`/people/${encodeURIComponent(h.id)}`} className="relative rounded px-1.5 py-0.5 font-bold underline underline-offset-2" data-press>
                      {CUSTODY_LABELS.open}
                      <LinkPending />
                    </Link>
                  ) : (
                    // 行ごとの受入は無色（主の操作の色は検索・新規登録の 1 つ）
                    <Button
                      size="sm"
                      icon={AddPersonIcon}
                      disabled={busyId !== null || !shelter.trim()}
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
      {!shelter.trim() && <p className="mt-1 text-xs font-bold text-state-check">{CUSTODY_ERROR_LABELS.shelter}</p>}
      {more && <p className="mt-1 text-xs text-muted">{CUSTODY_LABELS.more}</p>}
    </div>
  );
}

/** 台帳に無い人をその場で登録する。氏名・カナ・年齢か生年月日・薬・機器・連絡先 */
function RegisterPanel({ shelter }: { shelter: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [age, setAge] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [medications, setMedications] = useState("");
  const [devices, setDevices] = useState<DeviceKind[]>([]);
  const [relation, setRelation] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = await post(CUSTODY_REGISTER_API, {
      name,
      kana,
      age,
      birthDate,
      medications,
      devices,
      contact: { relation, name: contactName, phone },
      shelter,
    });
    setBusy(false);
    if (data.ok && data.personId) {
      router.push(`/people/${encodeURIComponent(data.personId)}`);
      return;
    }
    setError(data.label ?? "送信失敗");
  }

  const toggle = (d: DeviceKind) => setDevices((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-sm" data-form="register">
      <label className="flex flex-col gap-0.5">
        <span className="text-muted">{CUSTODY_LABELS.name}</span>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={INPUT} data-field="name" />
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
        <Button type="submit" kind="main" icon={AddPersonIcon} disabled={busy || !shelter.trim()} data-pending={busy ? "" : undefined}>
          {busy ? CUSTODY_LABELS.sending : CUSTODY_LABELS.register}
        </Button>
        {!shelter.trim() && <span className="text-xs font-bold text-state-check">{CUSTODY_ERROR_LABELS.shelter}</span>}
        {error && (
          <span role="alert" className="font-bold text-danger">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
