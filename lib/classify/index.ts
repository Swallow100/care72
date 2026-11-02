// 録音と自由文の分類（T12）。発災時に Claude が担う役はこれだけ: 分けるだけで、色と順位は lib/triage が決める。
//
// - classify.ts: 分ける本体（本番と訓練で同じ入力 ClassifyInput。伏せた文だけを Haiku に 1 回）
// - store.ts: 信号の行に書く（Claude の分類・分類なしの理由・人の直し）。サーバーだけ
// - view.ts: 信号の行を画面の形に（ブラウザでも読める）
// - http.ts: 人の直しの API の中身
// - labels.ts: 言葉

export {
  buildClassifyRequest,
  classify,
  classifyErrorOf,
  factsText,
  normalizeClassification,
  quoteOf,
  sealClassifyInput,
  type AudioFeatures,
  type Classification,
  type ClassifyInput,
  type ClassifyResult,
  type ClassifySource,
} from "./classify.ts";
export { CLASSIFY_SYSTEM, ClassifySchema, CONFIDENCE_MIN, QUOTE_MAX } from "./prompt.ts";
export {
  CLASS_EDIT_LOG_SOURCE,
  CLASSIFY_LOG_SOURCE,
  classifySignal,
  loadClassView,
  normalizeEdit,
  saveClassEdit,
  type ClassifyDeps,
  type ClassifyTarget,
} from "./store.ts";
export { CLASSIFY_COLUMNS, classViewOf, parseClassList, type ClassView, type SignalClassFields } from "./view.ts";
export { CLASS_LABELS, CLASSIFY_ERROR_LABELS, CLASSIFY_LABELS } from "./labels.ts";
