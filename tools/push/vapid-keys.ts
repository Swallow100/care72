// node tools/push/vapid-keys.ts: Web Push の送り手の鍵（VAPID、P-256）を 1 組作り、標準出力に 2 行（VAPID_PUBLIC_KEY= と VAPID_PRIVATE_KEY=）を出す（T149）。
// 作者が手元で 1 回だけ流し、出た値を Cloudflare の secret（配信）か .dev.vars（手元）に入れる。ファイルには書かない。
// 連絡先（VAPID_SUBJECT）は mailto: か https: の 1 行を自分で入れる。鍵を作り直すと、前の鍵で購読した端末は開いた時に作り直す
// （components/phone/PhoneSetup.tsx。それまでは届かない）。WebCrypto だけで作る（依存なし。lib/push/vapid.ts の generateVapidKeys）。
// 作業者（エージェント）は流さない。

import { generateVapidKeys } from "../../lib/push/vapid.ts";

const k = await generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\n`);
