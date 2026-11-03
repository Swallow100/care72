// アプリ内の確認・お知らせの窓の待ち行列（T51 で書き直した）。OS の confirm・alert・prompt は使わない。
// 窓は 1 度に 1 つ。開いた順に並べ、前の窓が閉じたら次を出す。描くのは components/ui/DialogHost.tsx（layout に 1 つ）。
// ここは DOM に触らない。待ち行列は createDialogs() で作れる形にして、テストは node で回す。
// 言葉の既定は lib/ui/labels.ts の DIALOG_LABELS。題と決める方のボタンは 2〜4 字の漢語。

import type * as IconSet from "@/components/ui/Icon";
import type { DialogIconName } from "@/components/ui/Icon";
import { DIALOG_LABELS } from "./labels";

/** 窓の種類。confirm は決める／取消、alert は閉じるだけ、choice は 2〜4 つから 1 つ、prompt は 1 行の文字 */
export type DialogKind = "confirm" | "alert" | "choice" | "prompt";

/** 選択肢のボタンに付けられるアイコン（components/ui/Icon の名前） */
export type ChoiceIconName = Exclude<keyof typeof IconSet, "DialogIconName">;

export type DialogOptions = {
  /** 窓の題（2〜4 字） */
  title?: string;
  /** 決める方のボタンの言葉（2〜4 字） */
  ok?: string;
  /** 消す・外す・戻す操作。決める方を赤の塗りにし、最初の焦点を取消に置く */
  danger?: boolean;
  /** 決める方のボタンのアイコン。無ければ danger は RemoveIcon、ほかは SaveIcon */
  icon?: DialogIconName;
  /** 本文の下に出す小さな箇条書き（消す項目を 1 行ずつなど） */
  details?: string[];
};

export type AlertOptions = { title?: string; details?: string[] };

export type ChoiceOption = { value: string; label: string; icon?: ChoiceIconName; danger?: boolean };
export type ChoiceOptions = { title?: string; details?: string[]; options: ChoiceOption[] };

export type PromptOptions = {
  title?: string;
  /** 欄の名前（読み上げと、欄の上の小さな字） */
  label?: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  /** 空のままでは決められない */
  required?: boolean;
  /** 決める方のボタンの言葉（2〜4 字） */
  ok?: string;
};

/** 窓が閉じたときの答え。confirm は真偽、alert は undefined、choice・prompt は文字か null（取消） */
export type DialogAnswer = boolean | string | null | undefined;

/** 描く側に渡す 1 つの窓。既定の言葉とアイコンは埋めてある */
export type DialogRequest = {
  id: number;
  kind: DialogKind;
  message: string;
  title: string;
  /** 決める方のボタン（choice では使わない） */
  ok: string;
  okIcon: DialogIconName;
  cancel: string;
  danger: boolean;
  details: string[];
  options: ChoiceOption[];
  field: { label: string; initial: string; placeholder: string; maxLength: number | undefined; required: boolean } | null;
  /** 開いたときに焦点を置く所 */
  focus: "ok" | "cancel" | "field" | "option";
};

/** 取消（Escape・外側・取消のボタン）のときの答え */
export function cancelAnswer(kind: DialogKind): DialogAnswer {
  if (kind === "confirm") return false;
  if (kind === "alert") return undefined;
  return null;
}

/** 開いたときの焦点。消す操作は取消に置き、Enter だけで消えないようにする */
export function initialFocus(kind: DialogKind, danger: boolean): DialogRequest["focus"] {
  if (kind === "prompt") return "field";
  if (kind === "choice") return "option";
  if (kind === "confirm" && danger) return "cancel";
  return "ok";
}

type Draft = {
  kind: DialogKind;
  message: string;
  title?: string;
  ok?: string;
  danger?: boolean;
  icon?: DialogIconName;
  details?: string[];
  options?: ChoiceOption[];
  field?: PromptOptions;
};

/** 呼ぶ側の指定に既定を埋める（題・ボタン・アイコン・焦点） */
export function fillRequest(id: number, d: Draft): DialogRequest {
  const danger = d.kind === "confirm" && d.danger === true;
  const title = d.title ?? (d.kind === "alert" ? DIALOG_LABELS.alert : DIALOG_LABELS.confirm);
  const ok = d.kind === "alert" ? DIALOG_LABELS.close : (d.ok ?? DIALOG_LABELS.ok);
  const okIcon: DialogIconName = d.kind === "alert" ? "CloseIcon" : (d.icon ?? (danger ? "RemoveIcon" : "SaveIcon"));
  const f = d.field;
  return {
    id,
    kind: d.kind,
    message: d.message,
    title,
    ok,
    okIcon,
    cancel: DIALOG_LABELS.cancel,
    danger,
    details: (d.details ?? []).filter((x) => x.trim() !== ""),
    options: d.kind === "choice" ? (d.options ?? []).slice(0, 4) : [],
    field:
      d.kind === "prompt"
        ? {
            label: f?.label ?? "",
            initial: f?.initial ?? "",
            placeholder: f?.placeholder ?? "",
            maxLength: f?.maxLength,
            required: f?.required === true,
          }
        : null,
    focus: initialFocus(d.kind, danger),
  };
}

/** prompt の欄の値で決められるか（required で空なら決められない、長すぎる物も） */
export function promptReady(field: DialogRequest["field"], value: string): boolean {
  if (!field) return true;
  if (field.required && value.trim() === "") return false;
  if (field.maxLength != null && value.length > field.maxLength) return false;
  return true;
}

export type Dialogs = {
  /** 窓を並べ、閉じたときの答えを返す */
  open(d: Draft): Promise<DialogAnswer>;
  /** 今出している窓（無ければ null） */
  current(): DialogRequest | null;
  /** 窓を閉じる。同じ窓を 2 度閉じても、答えは最初の 1 回 */
  settle(id: number, answer: DialogAnswer): void;
  /** 今の窓が変わったら呼ばれる。戻り値で外す */
  subscribe(listener: () => void): () => void;
  /** 並んでいる数（今の窓を含む） */
  size(): number;
};

/** 待ち行列を作る。アプリでは下の 1 つを使い、テストでは別に作る */
export function createDialogs(): Dialogs {
  let next = 1;
  const queue: { req: DialogRequest; resolve: (a: DialogAnswer) => void }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    open(d) {
      return new Promise<DialogAnswer>((resolve) => {
        queue.push({ req: fillRequest(next++, d), resolve });
        if (queue.length === 1) notify();
      });
    },
    current() {
      return queue[0]?.req ?? null;
    },
    settle(id, answer) {
      const head = queue[0];
      if (!head || head.req.id !== id) return;
      queue.shift();
      head.resolve(answer);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    size() {
      return queue.length;
    },
  };
}

/** アプリの待ち行列（DialogHost がこれを描く） */
export const dialogs = createDialogs();

/** 確かめてから進む。決めたら true、取消・Escape・外側なら false */
export function appConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  return dialogs.open({ kind: "confirm", message, ...options }).then((a) => a === true);
}

/** 知らせるだけ。閉じたら進む */
export function appAlert(message: string, options: AlertOptions = {}): Promise<void> {
  return dialogs.open({ kind: "alert", message, ...options }).then(() => undefined);
}

/** 2〜4 つから 1 つ選ぶ。選んだ value、取消なら null */
export function appChoice(message: string, options: ChoiceOptions): Promise<string | null> {
  return dialogs.open({ kind: "choice", message, title: options.title, details: options.details, options: options.options }).then((a) => (typeof a === "string" ? a : null));
}

/** 1 行の文字を受ける。決めた文字、取消なら null */
export function appPrompt(message: string, options: PromptOptions = {}): Promise<string | null> {
  return dialogs.open({ kind: "prompt", message, title: options.title, ok: options.ok, field: options }).then((a) => (typeof a === "string" ? a : null));
}
