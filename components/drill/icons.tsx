// 訓練の対応の欄のアイコン（Heroicons の 20px の塗りの版、MIT。THIRD_PARTY_NOTICES.md）。共通の名前は components/ui/Icon と同じ物を使う
// （電話・開く・再生と開始）。ほかの画面に無い 7 つの手の分だけここに置く。名前は操作の意味で付ける。
// アイコンだけのボタンにしない（CLAUDE.md「画面の決まり」）。必ず文字を添える。読み上げはしない（aria-hidden）。

import {
  BuildingLibraryIcon,
  HomeIcon,
  MapPinIcon,
  PhoneArrowDownLeftIcon,
  PhoneArrowUpRightIcon,
  ShieldCheckIcon,
  TruckIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, SVGProps } from "react";
import { PhoneIcon } from "@/components/ui/Icon";
import type { DrillAction } from "@/lib/db/types";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** 7 つの手のアイコン。本人電話は共通の電話、連絡先電話はかける矢印つきの電話 */
export const ACTION_ICONS: Record<DrillAction, IconType> = {
  call_person: PhoneIcon,
  call_contact: PhoneArrowUpRightIcon,
  visit: MapPinIcon,
  dispatch: TruckIcon,
  request_welfare_shelter: HomeIcon,
  report_city: BuildingLibraryIcon,
  evacuate_self: ShieldCheckIcon,
};

/** 着信（受ける矢印つきの電話） */
export const CallInIcon: IconType = PhoneArrowDownLeftIcon;

export function ActionIcon({ kind, className = "size-4" }: { kind: DrillAction; className?: string }) {
  const I = ACTION_ICONS[kind];
  return <I aria-hidden className={`shrink-0 ${className}`} />;
}
