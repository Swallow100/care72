// 訓練の対応の欄のアイコン（Heroicons の 20px の塗りの版、MIT。THIRD_PARTY_NOTICES.md）。共通の名前は components/ui/Icon と同じ物を使う
// （電話・開く・再生と開始）。ほかの画面に無い手の分だけここに置く。名前は操作の意味で付ける。
// アイコンだけのボタンにしない（CLAUDE.md「画面の決まり」）。必ず文字を添える。読み上げはしない（aria-hidden）。
// 手の名前・時間・相手は手の表（lib/drill/action-catalog.ts）。ここは手ごとの絵だけ（T91 で 18 に）。

import {
  BeakerIcon,
  BellAlertIcon,
  BoltIcon,
  BuildingLibraryIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  EnvelopeIcon,
  ChatBubbleBottomCenterTextIcon,
  EyeIcon,
  HomeIcon,
  MapPinIcon,
  PencilSquareIcon,
  PhoneArrowDownLeftIcon,
  PhoneArrowUpRightIcon,
  ShieldCheckIcon,
  TruckIcon,
  UserPlusIcon,
  ArrowsRightLeftIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, SVGProps } from "react";
import { PhoneIcon } from "@/components/ui/Icon";
import type { DrillAction } from "@/lib/db/types";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** 手のアイコン。本人電話は共通の電話、連絡先電話はかける矢印つきの電話 */
export const ACTION_ICONS: Record<DrillAction, IconType> = {
  call_person: PhoneIcon,
  call_contact: PhoneArrowUpRightIcon,
  // メッセージ（T125）
  message: EnvelopeIcon,
  visit: MapPinIcon,
  dispatch: TruckIcon,
  request_welfare_shelter: HomeIcon,
  report_city: BuildingLibraryIcon,
  evacuate_self: ShieldCheckIcon,
  // T91
  advise_119: BellAlertIcon,
  ask_check: EyeIcon,
  request_backup: UserPlusIcon,
  arrange_medicine: BeakerIcon,
  arrange_dialysis: CalendarDaysIcon,
  request_hospital: BuildingOffice2Icon,
  arrange_transport: ArrowsRightLeftIcon,
  arrange_power: BoltIcon,
  call_vendor: WrenchScrewdriverIcon,
  note: PencilSquareIcon,
  free: ChatBubbleBottomCenterTextIcon,
};

/** 着信（受ける矢印つきの電話） */
export const CallInIcon: IconType = PhoneArrowDownLeftIcon;

export function ActionIcon({ kind, className = "size-4" }: { kind: DrillAction; className?: string }) {
  const I = ACTION_ICONS[kind];
  return <I aria-hidden className={`shrink-0 ${className}`} />;
}
