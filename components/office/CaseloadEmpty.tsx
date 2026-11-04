// 担当一覧（/）が 0 人のときの「なし」（docs/tasks/T98.md の 2）。事業所の管理者で、絞る前の担当が 0 人なら、横に「利用者追加」の主のボタン
// （見出しの段の右上と同じ物）。管理者でないケアマネ・絞込で 0 人のときは「なし」だけ（誰が利用者追加できるかは変えない）。

import { ButtonLink } from "@/components/ui/Button";
import { AddPersonIcon } from "@/components/ui/Icon";
import { NEW_PERSON_PATH } from "@/lib/office/http-paths";
import { OFFICE_LABELS } from "@/lib/office/labels";

export function CaseloadEmpty({ addPerson }: { addPerson: boolean }) {
  if (!addPerson) {
    return (
      <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-muted" data-empty>
        {OFFICE_LABELS.none}
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-panel px-3 py-2" data-empty="add">
      <span className="text-muted">{OFFICE_LABELS.none}</span>
      <ButtonLink href={NEW_PERSON_PATH} kind="main" icon={AddPersonIcon}>
        {OFFICE_LABELS.addPerson}
      </ButtonLink>
    </div>
  );
}
