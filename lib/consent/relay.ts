// 医療班からケアマネジャーへの伝達（T172）。今はなし: 医療班の役は本人の経過に書き足さない（欄を出さず、API でも断る）。
// 受入・搬送・退所・受入依頼の受入と受入不可は事実としてそのまま出る（lib/custody。ケアマネが居場所を知るのに要る）。
// 行政の役は変わらない。true に戻すと、医療班の欄と API が前の形に戻る（使うのは lib/consent/scope.ts の 1 か所だけ）。

export const MEDICAL_TIMELINE_WRITES: boolean = false;
