// 入れる欄と面の編集から API（app/api/intake）を呼ぶ所。失敗は種類と画面の言葉（lib/intake/http.ts）で受ける。

import { INTAKE_LABELS } from "@/lib/labels";
import type { AiFailReason } from "@/lib/intake/http";

export type ApiError = { ok: false; error: string; label: string; reason?: AiFailReason };

export const isError = (x: unknown): x is ApiError => typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;

async function readJson<T>(res: Response, fallback: string): Promise<T | ApiError> {
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  return data ?? { ok: false, error: "network", label: fallback };
}

export async function postJson<T>(url: string, body: unknown): Promise<T | ApiError> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await readJson<T>(res, INTAKE_LABELS.failed);
  } catch {
    return { ok: false, error: "network", label: INTAKE_LABELS.failed };
  }
}

export async function postForm<T>(url: string, form: FormData): Promise<T | ApiError> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    return await readJson<T>(res, INTAKE_LABELS.aiFailed);
  } catch {
    return { ok: false, error: "network", label: INTAKE_LABELS.aiFailed };
  }
}
