// 手元の MCP サーバー（care72-local）。stdio で Claude Code とつなぐ。.mcp.json に登録してある。
// 手元の D1（npm run db:reset が作る SQLite）の種と訓練記録を読むだけ。書かない、ネットに出ない、鍵を読まない。
// 人のデータは lib/pseudonym を通してから返す（tools/mcp/care72-local/data.ts）。
//
// 動かし方: Claude Code が .mcp.json から起こす。手で起こすなら node tools/mcp/care72-local/server.ts（標準入出力で話す）。
// D1 のファイルは CARE72_D1_PATH があればそれ、無ければリポジトリの .wrangler の下から探す。
// 標準出力は MCP の通信だけに使う。知らせは標準エラーに書く。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { findLocalD1, LocalD1Missing, openReadOnly } from "./data.ts";
import { TOOLS, type ToolContext } from "./tools.ts";

/** リポジトリの根。Claude Code が渡す CLAUDE_PROJECT_DIR を先に、無ければこのファイルの場所から */
const projectDir = process.env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL("../../../", import.meta.url));

function dbPath(): string {
  const fromEnv = process.env.CARE72_D1_PATH?.trim();
  if (fromEnv) return fromEnv;
  const found = findLocalD1(projectDir);
  if (!found) throw new LocalD1Missing(".wrangler/state/v3/d1 に表のあるファイルが無い");
  return found;
}

const ctx: ToolContext = { open: () => openReadOnly(dbPath()) };

const server = new McpServer({ name: "care72-local", version: "0.1.0" });

for (const t of TOOLS) {
  server.registerTool(
    t.name,
    {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const answer = t.run(args, ctx);
        if (!answer.found) return { isError: true, content: [{ type: "text" as const, text: answer.message }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(answer.value, null, 2) }] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error(`care72-local: 読むだけで起動（道具 ${TOOLS.length} つ）`);
