// 本人のページと入れる欄だけで使うアイコン（Heroicons、MIT）。共通のアイコン（components/ui/Icon.tsx）と同じく、文字と並べて使う。
// 共通の部品は別の作業（T44）が直しているので、ここに置いた。取り込んだあとに components/ui/Icon.tsx へ移してよい。

export {
  ArrowPathIcon as RetryIcon, // 再試行
  CheckBadgeIcon as CheckIcon, // 頼り先を確認済にする
  QueueListIcon as SplitIcon, // 分ける（文を台帳の欄に分ける）
  DocumentArrowUpIcon as ReadFileIcon, // 写真・PDF を選んで読ませる
  MicrophoneIcon as MicIcon, // 話す
  PencilSquareIcon as EditIcon, // 面の編集
  StopIcon, // 話すのを止める
  PaintBrushIcon as PaintIcon, // 黒塗り: 引いて塗る（T52）
  HandRaisedIcon as MoveIcon, // 黒塗り: 拡大中に画像を送る
  ArrowUturnLeftIcon as UndoIcon, // 黒塗り: 一手戻す
  XCircleIcon as ClearIcon, // 黒塗り: この頁の四角を全部外す
  ChevronRightIcon as NextIcon, // 黒塗り: 次頁（前頁は共通の BackIcon）
} from "@heroicons/react/20/solid";
