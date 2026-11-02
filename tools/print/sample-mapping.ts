// node tools/print/sample-mapping.ts <出力の .sql> で、手元の D1 に入れる確認済の対応表（内閣府の様式例の固定の返事）の SQL を書く。
// 差し込みの紙面（/people/[id]/forms/mapped/[mappingId]）の見本を刷るためだけ。手元だけ: npx wrangler d1 execute DB --local --file=<出力>
// 返事は lib/forms/cao-form.fixture.ts（本物の Opus の返事ではない）。種の入れ直し（npm run db:fresh）で消える。
import { writeFileSync } from "node:fs";
import { DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID } from "../../lib/auth/demo.ts";
import { CAO_FORM_READ } from "../../lib/forms/cao-form.fixture.ts";
import { checkReadResult } from "../../lib/forms/mapping.ts";
import { insert } from "../../seed/sql.ts";

const out = process.argv[2];
if (!out) {
  console.error("使い方: node tools/print/sample-mapping.ts <出力の .sql>");
  process.exit(1);
}

export const SAMPLE_MAPPING_ID = "map-sample-cao";

const at = new Date().toISOString();
const sql = insert("form_mappings", {
  id: SAMPLE_MAPPING_ID,
  office_id: DEMO_OFFICE_ID,
  title: CAO_FORM_READ.title,
  form_hash: null,
  source_kind: "manual",
  mapping: JSON.stringify(checkReadResult(CAO_FORM_READ).mapping),
  status: "checked",
  ai_model: null,
  created_by: DEMO_CARE_MANAGER_ID,
  created_at: at,
  checked_by: DEMO_CARE_MANAGER_ID,
  checked_at: at,
  version: 1,
  updated_at: at,
});
writeFileSync(out, `DELETE FROM form_mappings WHERE id = '${SAMPLE_MAPPING_ID}';\n${sql}\n`);
console.log(`対応表 ${SAMPLE_MAPPING_ID} の SQL を ${out} に書いた`);
