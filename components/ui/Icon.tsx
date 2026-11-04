// 画面で使うアイコン（Heroicons、MIT。THIRD_PARTY.md）。操作の意味が一目で分かる所に、文字と並べて使う。
// アイコンだけのボタンにしない。ほかのアイコン集（ISC の Lucide など）は依存の決まりの外なので使わない。
// 大きさは 20px の塗りの版（mini）を、字の大きさに合わせて縮めて使う（Button が size-4 を当てる）。
//
// 名前は操作の意味で付ける。同じ操作は画面のどこでも同じアイコン。

/** 確認の窓の決める方のボタンに渡せるアイコン（lib/ui/dialog.ts） */
export type DialogIconName = "RemoveIcon" | "UnlistIcon" | "RestoreIcon" | "SaveIcon" | "CloseIcon";

export {
  ArrowDownIcon as MoveDownIcon, // 下へ動かす（様式の欄の位置、T86）
  ArrowLeftIcon as MoveLeftIcon, // 左へ動かす（様式の欄の位置、T86）
  ArrowRightIcon as MoveRightIcon, // 右へ動かす（様式の欄の位置、T86）
  ArrowUpIcon as MoveUpIcon, // 上へ動かす（様式の欄の位置、T86）
  ArrowDownCircleIcon as GoToIcon, // 同じ画面の操作の所へ送る（気象庁の欄の切替 → 切替のボタン、T72）
  ArrowDownTrayIcon as DownloadIcon, // CSV 出力
  ArrowRightEndOnRectangleIcon as LoginIcon, // ログイン（扉に入る矢印。ログアウトと対）
  ArrowUturnLeftIcon as RestoreIcon, // 外した物を戻す
  ArrowRightStartOnRectangleIcon as LogoutIcon, // ログアウト（扉から出る矢印）
  ArrowTopRightOnSquareIcon as ExternalIcon, // 外のブラウザで開く（本人・家族のスマホの追加の案内）
  ArrowUpOnSquareIcon as ShareIcon, // iPhone の共有（追加の案内の手順）
  ArrowsPointingOutIcon as FullIcon, // 全画面（地図）
  ArrowsRightLeftIcon as AssignIcon, // 担当の割当・移す
  ArrowPathIcon as RetryIcon, // 再作成・やり直す
  CheckCircleIcon as ChosenIcon, // 選んだ印（アンケートの選択肢、components/ui/Select の一覧）
  CheckIcon as SaveIcon, // 保存
  ClockIcon as LaterIcon, // 次回（入れる欄の問いを後に回す）
  ChevronDownIcon as OpenIcon, // 開く・畳む
  ChevronLeftIcon as BackIcon, // 戻る
  ChevronUpDownIcon as SortIcon, // 並べ替えできる列の見出しの印（押していない列。押している列は向きの印。T66）
  ClipboardDocumentIcon as CopyIcon, // コピー
  DocumentArrowUpIcon as ReadIcon, // 様式の読取（写真・PDF を AI が読む）
  DocumentTextIcon as PaperIcon, // 紙面の表示
  EllipsisVerticalIcon as BrowserMenuIcon, // Android の Chrome の右上のメニュー（追加の案内の手順）
  EyeIcon as ShowIcon, // パスワードを表示
  EyeSlashIcon as HideIcon, // パスワードを隠す
  LockClosedIcon as PasswordIcon, // パスワードの欄の印
  MagnifyingGlassIcon as SearchIcon, // 検索
  MagnifyingGlassMinusIcon as ZoomOutIcon, // 縮小（地図）
  MagnifyingGlassPlusIcon as ZoomInIcon, // 拡大（地図）
  LinkIcon, // リンク作成（アンケートの招待）
  NoSymbolIcon as DeclinedIcon, // 無回答（入れる欄の問い）
  MinusCircleIcon as RemoveIcon, // 外す（人でない物。対応表の欄など）
  PaperAirplaneIcon as SendIcon, // 送信（アンケートの答え）
  PencilSquareIcon as EditIcon, // 編集（AI の下書きを直す）
  PhoneIcon, // 電話
  PlayIcon, // 再生・開始
  PlusIcon as AddIcon, // 追加（人でない物）
  PrinterIcon as PrintIcon, // 印刷
  QrCodeIcon as QrIcon, // QR の作成・再作成
  QuestionMarkCircleIcon as UnknownIcon, // 不明（入れる欄の問い）
  UserIcon as IdIcon, // ID の欄の印
  UserMinusIcon as UnlistIcon, // 一覧から外す
  UserPlusIcon as AddPersonIcon, // 利用者追加・ケアマネ追加
  UsersIcon as RoleIcon, // 役変更（人の切替）
  ViewfinderCircleIcon as FitIcon, // 全体（地図を全員が入る大きさに戻す）
  XMarkIcon as CloseIcon, // 閉じる・取消
} from "@heroicons/react/20/solid";
