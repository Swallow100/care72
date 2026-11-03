// 本人のページの書類の「スマホ入口」（docs/tasks/T69a.md）。本人用と家族用のリンク（URL・コピー・QR の画像）と、発行・再発行。
// 形は lib/qr/phone-link-view.ts が組み、ここは描くだけ（状態を持たない。コピーと確認の窓だけクライアントの部品）。
// - 発行（版 0）・期限切れの再発行は操作の色。使えるリンクがあるときの再発行は赤で、確認の窓（前のリンクは全部無効）を通す
// - URL は文字で出す（押して開くリンクにしない。ケアマネの端末で開くと、その端末が本人のセッションに替わるので）
// - QR は lib/qr/image.ts の点の並びを白地に黒の画像（img）に。長押し・右クリックで保存して紙に貼れる。印刷の画面は作らない
// 本人・家族が開いて通らなかったときの 1 画面（PhoneLinkInvalid）もここに置く（やさしい日本語、無効とケアマネに連絡だけ）。

import { CopyButton } from "@/components/forms/CopyButton";
import { EasyWords } from "@/components/forms/EasyText";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Mark, StateTag, type Tone } from "@/components/ui/Tag";
import { easy } from "@/lib/forms/easy-words";
import { formatJst } from "@/lib/person";
import { qrMatrix, qrSvgPath, QR_QUIET } from "@/lib/qr/image";
import { PHONE_EASY, PHONE_LINK_CONFIRM, PHONE_LINK_LABELS, PHONE_LINK_STATUS_LABELS } from "@/lib/qr/phone-labels";
import type { PhoneLinkStatus } from "@/lib/qr/phone-link-store";
import type { PhoneLinkItem, PhoneLinkView } from "@/lib/qr/phone-link-view";

const STATUS_TONES: Record<PhoneLinkStatus, Tone> = { none: "unknown", active: "ok", expired: "check" };

/** 発行の API（app/api/people/[id]/phone/route.ts） */
export function phoneLinkApiPath(personId: string): string {
  return `/api/people/${encodeURIComponent(personId)}/phone`;
}

/** 状態の 1 行: 有効・期限・版。一覧外なら注意の印 */
export function PhoneLinkStatusLine({ view }: { view: PhoneLinkView }) {
  const { state } = view;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-phone-link-status={state.status}>
      <StateTag tone={STATUS_TONES[state.status]}>{PHONE_LINK_STATUS_LABELS[state.status]}</StateTag>
      {view.unlisted && <StateTag tone="check">{PHONE_LINK_LABELS.unlisted}</StateTag>}
      {state.expiresAt && (
        <span className="text-sm tabular-nums">
          {PHONE_LINK_LABELS.expires} {formatJst(state.expiresAt).slice(0, 10)}
        </span>
      )}
      {state.generation > 0 && (
        <span className="text-sm text-muted tabular-nums">
          {PHONE_LINK_LABELS.generation} {state.generation}
        </span>
      )}
    </span>
  );
}

/** 発行・再発行のフォーム（サーバーが 303 でこの画面に戻す）。一覧外の人には出さない */
export function PhoneLinkIssueForm({ view }: { view: PhoneLinkView }) {
  if (view.unlisted) return null;
  const { status, generation } = view.state;
  const active = status === "active";
  return (
    <form method="post" action={phoneLinkApiPath(view.personId)} data-phone-link-issue>
      <SubmitButton
        kind={active ? "danger" : "main"}
        icon={generation === 0 ? "LinkIcon" : "RetryIcon"}
        confirm={active ? { ...PHONE_LINK_CONFIRM, danger: true } : undefined}
      >
        {generation === 0 ? PHONE_LINK_LABELS.issue : PHONE_LINK_LABELS.reissue}
      </SubmitButton>
    </form>
  );
}

/** QR の画像。白地に黒（ダークでも反転させない）。img にして長押し・右クリックで保存できるように */
export function PhoneLinkQr({ url, label }: { url: string; label: string }) {
  const m = qrMatrix(url);
  const box = m.size + QR_QUIET * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${qrSvgPath(m)}" fill="#000"/></svg>`;
  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt={label}
      width={128}
      height={128}
      className="block size-32 shrink-0 rounded-sm bg-[#fff]"
      data-phone-link-qr
    />
  );
}

/** 1 行: 本人用・家族用の名前と印、URL とコピー、QR */
export function PhoneLinkRow({ item, status }: { item: PhoneLinkItem; status: PhoneLinkStatus }) {
  const kindLabel = item.kind === "self" ? PHONE_LINK_LABELS.self : PHONE_LINK_LABELS.family;
  const urlId = `phone-link-${item.key}`;
  return (
    <li className="flex flex-col gap-2 rounded-md bg-panel2 p-2 sm:flex-row sm:items-start" data-phone-link={item.kind} data-key={item.key}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-bold">{kindLabel}</span>
          {item.relation && <span className="text-sm text-muted">{item.relation}</span>}
          <span className="font-bold">{item.name}</span>
          {item.smartphone && <Mark inPanel2>{item.smartphone}</Mark>}
        </div>
        {item.url ? (
          <>
            <p id={urlId} className="rounded bg-panel px-2 py-1 text-xs break-all select-all" data-phone-link-url>
              {item.url}
            </p>
            <div>
              <CopyButton text={item.url} targetId={urlId} inPanel2 />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{PHONE_LINK_STATUS_LABELS[status === "active" ? "none" : status]}</p>
        )}
      </div>
      {item.url && <PhoneLinkQr url={item.url} label={`${kindLabel} ${PHONE_LINK_LABELS.qr}`} />}
    </li>
  );
}

/** 本人用と家族用の 2 つの面 */
export function PhoneLinkPanel({ view }: { view: PhoneLinkView }) {
  const status: PhoneLinkStatus = view.unlisted ? "none" : view.state.status;
  return (
    <div className="space-y-3" data-phone-link-panel>
      <Panel>
        <PanelHead title={PHONE_LINK_LABELS.self} />
        <ul className="mt-2">
          <PhoneLinkRow item={view.self} status={status} />
        </ul>
      </Panel>
      <Panel>
        <PanelHead title={PHONE_LINK_LABELS.family} count={view.family.length} />
        {view.family.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{PHONE_LINK_LABELS.none}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {view.family.map((item) => (
              <PhoneLinkRow key={item.key} item={item} status={status} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * 本人・家族の平時の頁の上: 事業所名と「ふだん」の印（T69a）。印だけで、「いまは ふだん です」の文にしない。
 * 色は付けない（灰は「不明」の色なので使わない。ヘッダーの「平時」と同じ薄い文字）
 */
export function PhoneNormalMark({ office }: { office: string | null }) {
  return (
    <p className="phone-text mb-2 flex flex-wrap items-baseline gap-x-2 px-1 text-lg" data-mode="normal">
      {office && <span>{office}</span>}
      <span className="text-muted">
        <EasyWords words={easy(PHONE_EASY.normal)} />
      </span>
    </p>
  );
}

/** 通らないリンクを開いたとき（/s/invalid）。どれで落ちたかも誰のリンクかも出さない */
export function PhoneLinkInvalid() {
  return (
    <section className="phone-text rounded-lg bg-panel px-4 py-4" data-phone-link-invalid>
      <StateTag tone="unknown" size="md">
        <EasyWords words={easy(PHONE_EASY.invalid)} />
      </StateTag>
      <p className="mt-3 text-xl">
        <EasyWords words={easy(PHONE_EASY.callCareManager)} />
      </p>
    </section>
  );
}
