// answers.md の読み・数え・見張りと、質問の文書（QUESTIONS.md・paper.html・README.md）の言葉の一致。
// 例の回答は全部作り物（実在の人・事業所とは関係ない）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnswersError,
  collectFreeItems,
  combinedCount,
  findRisks,
  parseAnswers,
  ratio,
  refOf,
  tallyChoice,
} from "./answers.ts";
import { CHOICE_QUESTIONS, COLUMNS, COMBINED, FREE_QUESTIONS } from "./questions.ts";

const HEADER = `| ${COLUMNS.join(" | ")} |`;
const SEPARATOR = `| ${COLUMNS.map(() => "---").join(" | ")} |`;

type Row = Partial<Record<string, string>>;

/** 列の名前から 1 行を作る（書かない列は空） */
function row(r: Row): string {
  return `| ${COLUMNS.map((c) => r[c] ?? "").join(" | ")} |`;
}

function table(...rows: Row[]): string {
  return ["# 答え", "", HEADER, SEPARATOR, ...rows.map(row), ""].join("\n");
}

const R1: Row = {
  番号: "001",
  役: "a",
  経験: "c",
  問1: "b",
  問2: "d",
  問3: "b",
  問4: "b,c,f",
  問5: "書く時間が取れない",
  問6: "a,b",
  問7: "c",
  問8: "b",
  問9: "a",
  問9理由: "話すだけなら続けられる",
  引用: "a",
};
const R2: Row = { 番号: "002", 役: "d", 役その他: "相談員", 経験: "a", 問1: "a", 問2: "g", 問3: "d", 問4: "", 問5: "", 問6: "f", 問7: "b", 問8: "c", 問9: "b", 問9理由: "", 引用: "b" };
const R3: Row = { 番号: "003", 役: "a", 経験: "b", 問1: "b", 問2: "e", 問3: "c", 問4: "a・b", 問5: "様式の欄が多い", 問6: "e", 問7: "c", 問8: "c", 問9: "c", 問9理由: "任せきりは不安", 引用: "a" };

describe("parseAnswers", () => {
  it("1 行が 1 人。記号と自由記述を読む", () => {
    const rs = parseAnswers(table(R1, R2));
    expect(rs).toHaveLength(2);
    expect(rs[0].id).toBe("001");
    expect(rs[0].choices.role).toEqual(["a"]);
    expect(rs[0].choices.q4).toEqual(["b", "c", "f"]);
    expect(rs[0].choices.q6).toEqual(["a", "b"]);
    expect(rs[0].choices.quote).toEqual(["a"]);
    expect(rs[0].free.q5).toBe("書く時間が取れない");
    expect(rs[1].choices.q4).toEqual([]);
    expect(rs[1].free.q5).toBeNull();
    expect(rs[1].free.q9reason).toBeNull();
    expect(rs[1].free.roleOther).toBe("相談員");
  });

  it("見出しだけなら 0 人", () => {
    expect(parseAnswers(table())).toEqual([]);
  });

  it("記号は大文字・全角・区切りの違いを許す。ハイフンは答えなし", () => {
    const [r] = parseAnswers(table({ ...R1, 問1: "Ｂ", 問4: "ａ、ｃ ｇ", 問7: "-", 問8: "なし" }));
    expect(r.choices.q1).toEqual(["b"]);
    expect(r.choices.q4).toEqual(["a", "c", "g"]);
    expect(r.choices.q7).toEqual([]);
    expect(r.choices.q8).toEqual([]);
  });

  it("列の並びが違っても名前で読む", () => {
    const cols = [...COLUMNS].reverse();
    const text = [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, `| ${cols.map((c) => R1[c] ?? "").join(" | ")} |`].join("\n");
    expect(parseAnswers(text)[0].choices.q2).toEqual(["d"]);
  });

  it("読めない所は行ごとにまとめて知らせる", () => {
    const bad = [
      HEADER,
      SEPARATOR,
      row({ ...R1, 問1: "z" }),
      row({ ...R1, 番号: "002", 問2: "ab" }),
      row({ ...R1, 番号: "002" }),
      row({ ...R1, 番号: "" }),
      `| 004 | a |`,
    ].join("\n");
    let error: unknown;
    try {
      parseAnswers(bad);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AnswersError);
    const p = (error as AnswersError).problems.join("\n");
    expect(p).toContain("問1 の記号が合わない");
    expect(p).toContain("問2 は 1 つだけ");
    expect(p).toContain("番号 002 が重なっている");
    expect(p).toContain("番号が空");
    expect(p).toContain("列の数が合わない");
  });

  it("列が足りない・知らない列・表が無い", () => {
    expect(() => parseAnswers("| 番号 | 役 |\n| --- | --- |\n| 001 | a |")).toThrow(/列が足りない/);
    expect(() => parseAnswers(`${HEADER.slice(0, -1)}| 名前 |\n`)).toThrow(/知らない列/);
    expect(() => parseAnswers("答えはまだ無い")).toThrow(/表が見つからない/);
  });
});

describe("集計", () => {
  const rs = parseAnswers(table(R1, R2, R3));

  it("問ごとに、答えた人と選んだ人を数える（問 4・問 6 は複数）", () => {
    const q4 = tallyChoice(rs, "q4");
    expect(q4.answered).toBe(2);
    expect(q4.blank).toBe(1);
    expect(q4.rows.find((r) => r.label === "書く時間が無い")?.n).toBe(2);
    expect(q4.rows.find((r) => r.label === "様式が分かりにくい")?.n).toBe(1);
    expect(q4.rows.find((r) => r.label === "その他")?.n).toBe(0);

    const q7 = tallyChoice(rs, "q7");
    expect(q7.answered).toBe(3);
    expect(q7.rows.map((r) => r.n)).toEqual([0, 1, 2]);
  });

  it("合算は答えた人が母数", () => {
    const q2 = COMBINED.find((c) => c.key === "q2")!;
    // 「作ったことがない」の人（002）は母数に入れない
    expect(combinedCount(rs, q2)).toEqual({ answered: 2, n: 2 });
    const q9 = COMBINED.find((c) => c.key === "q9")!;
    expect(combinedCount(rs, q9)).toEqual({ answered: 3, n: 2 });
    const q1 = COMBINED.find((c) => c.key === "q1")!;
    expect(combinedCount(rs, q1)).toEqual({ answered: 3, n: 3 });
  });

  it("N 人中 M 人の形", () => {
    expect(ratio(2, 12)).toBe("12 人中 2 人");
  });
});

describe("findRisks（名前・電話・リンクの見張り）", () => {
  it("電話・メール・リンク・人名らしい敬称を見つける", () => {
    expect(findRisks("090-0000-0001 に電話した")).toContain("電話番号らしい並び");
    expect(findRisks("０９０−００００−０００１")).toContain("電話番号らしい並び");
    expect(findRisks("連絡は a.b@example.org へ")).toContain("メールアドレスらしい並び");
    expect(findRisks("https://example.org/x を見て")).toContain("リンク");
    expect(findRisks("山田さんの家は遠い")).toContain("人名らしい「〇〇さん・様」");
    expect(findRisks("田中様に確認した")).toContain("人名らしい「〇〇さん・様」");
  });

  it("ふつうの言葉は止めない", () => {
    for (const text of [
      "様式が分かりにくい",
      "計画様式の欄が多い",
      "氏名を書く欄が小さい",
      "ご家族様に聞きにくい",
      "利用者さんの都合に合わせると時間が無い",
      "ケアマネさん同士で共有できない",
      "30 分〜1 時間かかる。2026 年 11 月に 3 件作った",
      "市町村とのやり取りが多い",
    ]) {
      expect(findRisks(text), text).toEqual([]);
    }
  });

  it("疑った文字そのものは返さない", () => {
    const reasons = findRisks("山田さん 090-0000-0001").join("");
    expect(reasons).not.toMatch(/山田|0000/);
  });
});

describe("collectFreeItems", () => {
  it("引用が「よい」の人の、疑いの無い記入欄だけを渡す", () => {
    const rs = parseAnswers(
      table(
        R1,
        { ...R3, 問5: "山田さんの家の確認が大変", 問9理由: "090-0000-0001" },
        { ...R2, 役その他: "", 問5: "引用はよくないと書いたのに写してある" },
        { ...R2, 番号: "004", 役その他: "", 引用: "", 問9理由: "引用の答えが空" },
        { ...R1, 番号: "005", 問5: "", 問9理由: "", 問4: "g", 問4その他: "電話がつながらない" },
      ),
    );
    const { items, held } = collectFreeItems(rs);
    expect(refOf("q5", "001")).toBe("問5-001");
    expect(items.map((i) => i.ref)).toEqual([refOf("q5", "001"), refOf("q9reason", "001"), refOf("q4Other", "005")]);
    expect(held.map((h) => h.ref).sort()).toEqual(
      [refOf("q5", "003"), refOf("q9reason", "003"), refOf("q5", "002"), refOf("q9reason", "004")].sort(),
    );
    expect(held.find((h) => h.ref === refOf("q5", "002"))?.reasons[0]).toMatch(/引用が「よい」でない/);
    expect(held.find((h) => h.ref === refOf("q9reason", "003"))?.reasons).toContain("電話番号らしい並び");
  });
});

// ---------- 文書との一致 ----------

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("質問の文書", () => {
  const questions = read("docs/survey/QUESTIONS.md");
  const paper = read("docs/survey/paper.html");
  const readme = read("docs/survey/README.md");

  it("問いの文と選択肢の言葉が QUESTIONS.md にある（並びも同じ。paper.html は使わない。Web 版に移した）", () => {
    expect(paper).toContain("Web 版に移した");
    for (const q of CHOICE_QUESTIONS) expect(questions, q.column).toContain(q.text);
    for (const q of FREE_QUESTIONS) expect(questions, q.column).toContain(q.text);
    for (const doc of [questions]) {
      for (const q of CHOICE_QUESTIONS) {
        // 「問3　」の見出しから後ろで、選択肢が紙の並びの順に出る
        const n = /^q(\d)$/.exec(q.key)?.[1];
        let from = n ? doc.indexOf(`問${n}　`) : 0;
        expect(from, `${q.column} の見出し`).toBeGreaterThanOrEqual(0);
        for (const c of q.choices) {
          const at = doc.indexOf(c.label, from);
          expect(at, `${q.column} ${c.label}`).toBeGreaterThanOrEqual(0);
          if (n) from = at;
        }
      }
    }
  });

  it("README の記号の表が、questions.ts の記号・言葉と同じ", () => {
    for (const q of CHOICE_QUESTIONS) {
      for (const c of q.choices) expect(readme, `${q.column} ${c.code}`).toContain(`${c.code} ${c.label}`);
    }
    for (const col of COLUMNS) expect(readme).toContain(col);
  });

  it("先頭の匿名の 2 行がある", () => {
    for (const doc of [questions]) {
      expect(doc).toContain("名前・事業所名・利用者のことは書かないでください");
      expect(doc).toContain("結果は匿名で、作品の説明と動画に");
      expect(doc).toContain("人中");
    }
    expect(FREE_QUESTIONS.map((q) => q.column)).toEqual(["問5", "問9理由", "ご意見"]);
  });

  it("言葉の決まり: 診断・判定・重症・病気がわかる、を使わない", () => {
    for (const [name, doc] of [["QUESTIONS.md", questions], ["paper.html", paper], ["README.md", readme]] as const) {
      expect(doc, name).not.toMatch(/診断|判定|重症|病気がわかる/);
    }
  });

  it("答えの置き場（answers.md）の見出しの行が、質問の表の列と合っている（答えの行は見ない。写し間違いで npm test を落とさない）", () => {
    const headerOnly = read("docs/survey/answers.md")
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("|"))
      .slice(0, 2)
      .join("\n");
    expect(parseAnswers(headerOnly)).toEqual([]);
  });
});
