"use client";

// 利用者追加の欄（docs/tasks/T30.md）。最小の項目（氏名・カナ・生年月日・性別・担当）で作り、作ったら本人のページ
// （担当一覧の右の面 /?open=<id>）へ移る。続きは本人のページの入れる欄（T03）で入れる。
// 送るのは /api/people（JSON）。断られたら入れた値を残したまま理由を出す。作成は主の操作（操作の色）、取消は来た画面へ戻る。
// 送信中は「送信中」と押した灰色を残し、二度押しを止める。

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Sex } from "@/lib/db/types";
import { SEXES } from "@/lib/db/types";
import { SEX_LABELS } from "@/lib/labels";
import { KANA_MAX, NAME_MAX } from "@/lib/office/forms";
import { PEOPLE_API_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CloseIcon, SaveIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";

type CareManager = { id: string; name: string };

const INPUT =
  "h-9 w-full min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const CHOICE = "flex h-9 items-center gap-1.5 rounded bg-panel2 px-2.5 text-sm";

export function NewPersonForm({
  careManagers,
  defaultCareManagerId,
  today,
  back = "/",
}: {
  careManagers: CareManager[];
  defaultCareManagerId: string | null;
  today: string;
  /** 取消の戻り先（来た画面） */
  back?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const first = careManagers.find((c) => c.id === defaultCareManagerId)?.id ?? careManagers[0]?.id ?? "";
  const [careManagerId, setCareManagerId] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(PEOPLE_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kana, birthDate, sex, careManagerId }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; href?: string; label?: string } | null;
      if (data?.ok && data.href) {
        router.push(data.href);
        return;
      }
      setError(data?.label ?? "送信失敗");
    } catch {
      setError("送信失敗");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {error && (
        <p role="alert" className="text-sm font-bold text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{OFFICE_LABELS.name}</span>
          <input
            type="text"
            name="name"
            required
            maxLength={NAME_MAX}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{OFFICE_LABELS.kana}</span>
          <input
            type="text"
            name="kana"
            required
            maxLength={KANA_MAX}
            autoComplete="off"
            value={kana}
            onChange={(e) => setKana(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{OFFICE_LABELS.birth}</span>
          <input
            type="date"
            name="birthDate"
            required
            min="1900-01-01"
            max={today}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className={INPUT}
          />
        </label>
        <fieldset>
          <legend className="text-xs text-muted">{OFFICE_LABELS.sex}</legend>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {SEXES.map((s) => (
              <label key={s} className={CHOICE}>
                <input
                  type="radio"
                  name="sex"
                  value={s}
                  required
                  checked={sex === s}
                  onChange={() => setSex(s)}
                  className="accent-accent"
                />
                {SEX_LABELS[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{OFFICE_LABELS.careManager}</span>
          <Select
            name="careManagerId"
            required
            value={careManagerId}
            onChange={(e) => setCareManagerId(e.target.value)}
            className={INPUT}
          >
            {careManagers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <Button type="submit" kind="main" icon={SaveIcon} disabled={busy} data-pending={busy ? "" : undefined}>
          {busy ? OFFICE_LABELS.sending : OFFICE_LABELS.create}
        </Button>
        <ButtonLink href={back} kind="quiet" icon={CloseIcon}>
          {OFFICE_LABELS.cancel}
        </ButtonLink>
      </div>
    </form>
  );
}
