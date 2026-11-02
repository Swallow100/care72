// 本人のページと入れる欄（T03）を並べる。面の幅が広ければ入れる欄は右に留め、狭ければ上に出す（container query）。
// 単独のページ（/people/[id]）と担当一覧の右の面（/?open=<id>）で同じ形。入れる欄を持つのはケアマネの役だけ。

import type { IntakeProps } from "@/lib/intake/props";
import type { PersonView as View } from "@/lib/person";
import { Intake } from "./Intake";
import type { Level } from "./parts";
import { PersonView } from "./PersonView";

export function PersonWithIntake({ view, level, intake }: { view: View; level: Level; intake: IntakeProps | null }) {
  if (!intake) return <PersonView view={view} level={level} />;
  return (
    <div className="@container">
      <div className="grid gap-2 @[56rem]:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 min-w-0 @[56rem]:order-1">
          <PersonView view={view} level={level} />
        </div>
        <aside
          aria-label="入力"
          className="order-1 min-w-0 self-start @[56rem]:sticky @[56rem]:top-2 @[56rem]:order-2 @[56rem]:max-h-[calc(100dvh-1rem)] @[56rem]:overflow-y-auto"
        >
          <Intake {...intake} level={level} />
        </aside>
      </div>
    </div>
  );
}
