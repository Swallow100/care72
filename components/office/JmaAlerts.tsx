// 事業所の画面の気象庁の欄（T72 の 2。server）。D1 の写しを読んで JmaAlertsView に渡す。
// 読めなくても事業所の画面は壊さない（自分の中で受け止めて「未取得」の 1 行にする。審査員の流れを止めない）。

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { EMPTY_ALERTS, loadJmaAlerts, type JmaAlertsData } from "@/lib/jma/alerts";
import { JmaAlertsView } from "./JmaAlertsView";

export async function JmaAlerts({ officeId, disaster, now, switchHref }: { officeId: string; disaster: boolean; now: string; switchHref: string }) {
  let data: JmaAlertsData = EMPTY_ALERTS;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = await loadJmaAlerts(env.DB, officeId, now);
  } catch (e) {
    console.error("気象庁の欄を読めない", e);
  }
  return <JmaAlertsView data={data} disaster={disaster} switchHref={switchHref} />;
}
