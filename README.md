# ケア72（Care72）

ケアマネが持っている利用者のことを、災害の最初の 72 時間に届ける。計画 → 訓練 → 発災時。

このリポジトリは Built with Claude: Japan 2026 の期間中（2026-11-02 12:30 JST 以降）に作った。設計はキックオフ前に文書で行い、docs/SPEC.md に写した。

この道具は診断・用量・医療助言をしない。安否の色と連絡の順位はコードに書いたルールの表（lib/triage）で出し、AI は決めない。利用者は全員架空。

ルールの表を人が読める形にした物: [docs/TRIAGE.md](docs/TRIAGE.md)（コードから作る。`npm run docs:triage`）。

## 触り方

ログイン（審査員の ID とパスワード）は提出書類に書く。

## 作るもの

- 計画: 台帳（本人・薬・病気・関係・行動・特記）から個別避難計画の様式を埋める
- 訓練: 利用者ごとのエージェントが 72 時間を早送りで動き、ケアマネの対応を採点する
- 発災時: 本人・家族の赤緑の 2 ボタンと録音、ケアマネの一覧の並び替え、医療班・行政への受け渡し

## 守り

- 鍵は .dev.vars（手元。.dev.vars.example は項目だけ）と Cloudflare の secret だけ。.env・.dev.vars は commit しない
- AI（Claude と Gemini TTS）の呼び出しは事業所ごとに 1 日の上限（既定 200 回）。超えたらその日は呼ばない
- 個人の情報は Claude に渡す前に仮名化する（lib/pseudonym）
- 本運用の条件: 事業所との委託契約、学習に使わない契約、電気通信事業法の確認

## 使った資料と方法

期間中に足す。使った物だけ書く。

- Claude Code: 設計（Fable）と実装（Opus のサブエージェント）の分担、作業ごとの brief、テスト先行、フックで守りを強制、Skill で手順を固定、読むだけの見直し役（.claude/agents）、手元の D1 を仮名で読む MCP。数字と commit の hash は [docs/CLAUDE_CODE.md](docs/CLAUDE_CODE.md)
- [Claude Code のベストプラクティス](https://code.claude.com/docs/en/best-practices): 「Deterministic and non-deterministic instructions」「Enforce steps with hooks」→ 必ず守る物（ネットに出る wrangler・鍵のファイル・履歴の書き換え）はフック（tools/hooks）、目安は CLAUDE.md。「Put team procedures in skills」→ .claude/skills。「Give Claude a check to run」→ テストを先に書き、.ts を書いたらフックが型の検査。「Know what subagents cost」→ 見直し役は読むだけの道具で、ペルソナの確かめは haiku。「Connect the tools Claude needs」→ MCP の care72-local。「Run sessions in parallel」→ worktree と branch で 2 つのアカウント
- [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents): 「Workflow: Routing」→ 用途ごとのモデル（分類は Haiku、様式の読み取りは Opus。lib/claude/models.ts）と、Skill の care72-review が変えたファイルで見直し役を選ぶ形。「Workflow: Parallelization」の sectioning → 3 つの見直し役を並べて走らせる。「Agents」の人の確認 → 発災時は Claude を分類だけにし、色と順位はルールの表とケアマネ。「Appendix 2: Prompt engineering your tools」の poka-yoke → 仮名化を通らない物は型で Claude に渡せない（lib/pseudonym の ForClaude）。「Workflow: Orchestrator-workers」→ 訓練の Opus の監督と 10 体の Haiku（作る物）
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 「Sub-agent architectures」→ 見直し役は自分の文脈で読み、表だけを返す。「Structured note-taking」→ docs/tasks の brief と進みの記録（docs/PROGRESS.md・docs/progress）でセッションをまたぐ。「Context retrieval and agentic search」の just in time → MCP は一覧で仮名と id だけを返し、台帳は person で 1 人ずつ読む
- [Claude Cookbooks](https://github.com/anthropics/claude-cookbooks)（まだ使っていない。作るときに読む）: multimodal/using_sub_agents（Haiku を Opus と組む）→ 訓練（docs/tasks/T18.md・T19.md）。multimodal/how_to_transcribe_text（様式から中身を取る）→ 様式の読み取り（docs/tasks/T08.md）。capabilities/classification → 録音と自由文の分類（docs/tasks/T12.md）

## 進み

docs/PROGRESS.md。期間中の判断は docs/DECISIONS.md。

## ライセンス

AGPL-3.0（LICENSE）。本運用で別の条件が要るときは作者に相談する。
