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
} from "@heroicons/react/20/solid";
