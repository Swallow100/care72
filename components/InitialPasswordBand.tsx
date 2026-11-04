import { ButtonLink } from "@/components/ui/Button";
import { PasswordIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import { OFFICE_LABELS } from "@/lib/office/labels";

// 初期パスワードのまま入った人の印（T114 の問い 1 の (b)）。ヘッダーの 2 段目の右（自分のことの下）に、黄の塗りの印「初期パスワード」と
// 「変更」（押すと自分のパスワードの変更の欄を開いた形で送る。ケアマネは事業所の画面の自分の行、医療班・行政は受入一覧）。
// 変えるまでほかの画面へ行けない、にはしない。出すかと送り先は lib/auth/password-change.ts の initialPasswordHref
// （審査員・役を替えた山本・審査員が足したアカウント・種の固定のアカウントには出さない）。本人が変えると印は表から消え、次の描き直しで消える。
// ヘッダーの右の並び（事業所名 → 今の役 → 役変更 → ログアウト）には割り込まない。説明文は置かない。

export const INITIAL_PASSWORD_LABELS = {
  /** 印（黄の塗り。黄は文字の色に使わない） */
  mark: OFFICE_LABELS.initialPassword,
  /** 変更の欄へ */
  change: "変更",
} as const;

export function InitialPasswordBand({ href }: { href: string }) {
  return (
    <div
      role="status"
      className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-end gap-x-2 gap-y-1 px-4 pb-1.5 text-sm"
      data-initial-password
    >
      <StateTag tone="check">{INITIAL_PASSWORD_LABELS.mark}</StateTag>
      <ButtonLink href={href} icon={PasswordIcon} data-initial-password-change>
        {INITIAL_PASSWORD_LABELS.change}
      </ButtonLink>
    </div>
  );
}
