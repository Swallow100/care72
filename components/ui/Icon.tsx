// 画面で使うアイコン（Heroicons、MIT。THIRD_PARTY.md）。操作の意味が一目で分かる所に、文字と並べて使う。
// アイコンだけのボタンにしない。ほかのアイコン集（ISC の Lucide など）は依存の決まりの外なので使わない。
// 大きさは 20px の塗りの版（mini）を、字の大きさに合わせて縮めて使う（Button が size-4 を当てる）。
//
// 名前は操作の意味で付ける。同じ操作は画面のどこでも同じアイコン。

export {
  ArrowDownTrayIcon as DownloadIcon, // CSV 出力
  ArrowRightEndOnRectangleIcon as LoginIcon, // ログイン（扉に入る矢印。ログアウトと対）
  ArrowUturnLeftIcon as RestoreIcon, // 外した物を戻す
  ArrowRightStartOnRectangleIcon as LogoutIcon, // ログアウト（扉から出る矢印）
  ArrowsRightLeftIcon as AssignIcon, // 担当の割当・移す
  ArrowPathIcon as RetryIcon, // 再作成・やり直す
  CheckCircleIcon as ChosenIcon, // 選んだ印（アンケートの選択肢）
  CheckIcon as SaveIcon, // 保存
  ChevronDownIcon as OpenIcon, // 開く・畳む
  ChevronLeftIcon as BackIcon, // 戻る
  ClipboardDocumentIcon as CopyIcon, // コピー
  DocumentTextIcon as PaperIcon, // 紙面の表示
  EyeIcon as ShowIcon, // パスワードを表示
  EyeSlashIcon as HideIcon, // パスワードを隠す
  LockClosedIcon as PasswordIcon, // パスワードの欄の印
  MagnifyingGlassIcon as SearchIcon, // 検索
  LinkIcon, // リンク作成（アンケートの招待）
  MinusCircleIcon as RemoveIcon, // 外す（人でない物。対応表の欄など）
  PaperAirplaneIcon as SendIcon, // 送信（アンケートの答え）
  PencilSquareIcon as EditIcon, // 編集（AI の下書きを直す）
  PhoneIcon, // 電話
  PlayIcon, // 再生・開始
  PlusIcon as AddIcon, // 追加（人でない物）
  PrinterIcon as PrintIcon, // 印刷
  UserIcon as IdIcon, // ID の欄の印
  UserMinusIcon as UnlistIcon, // 一覧から外す
  UserPlusIcon as AddPersonIcon, // 利用者追加・ケアマネ追加
  UsersIcon as RoleIcon, // 役変更（人の切替）
  XMarkIcon as CloseIcon, // 閉じる・取消
} from "@heroicons/react/20/solid";
