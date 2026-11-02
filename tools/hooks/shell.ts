// Bash と PowerShell の命令の文字列を、フックが見るための「単純な命令」の並びに分ける（tools/hooks/rules.ts が使う）。
// 本物のシェルの文法を全部は追わない。止める物を見落とさない向きに倒し、引用符の中の文（commit の文など）は 1 語のまま残す。
// 分ける所: 改行・; | & ( )。$( ) と Bash の ` ` の中は別の文として返す（rules.ts が同じ決まりで検める）。
// ヒアドキュメント（<<EOF … EOF）の中身は命令にせず、その命令の heredocs に入れる。

export type Dialect = "bash" | "powershell";

export type SimpleCommand = {
  /** 語（引用符を外した物）。リダイレクトの行き先は入れない */
  words: string[];
  /** リダイレクトの行き先（> >> < の後ろの語） */
  redirects: string[];
  /** ヒアドキュメントの中身 */
  heredocs: string[];
};

export type Parsed = {
  commands: SimpleCommand[];
  /** $( ) と ` ` の中の文 */
  substitutions: string[];
};

type PendingHeredoc = { delim: string; strip: boolean; cmd: SimpleCommand };

const empty = (): SimpleCommand => ({ words: [], redirects: [], heredocs: [] });

export function parse(src: string, dialect: Dialect): Parsed {
  const commands: SimpleCommand[] = [];
  const substitutions: string[] = [];
  const pending: PendingHeredoc[] = [];
  /** 逃がしの文字。Bash は \、PowerShell は ` */
  const esc = dialect === "bash" ? "\\" : "`";
  const n = src.length;

  let cmd = empty();
  let word: string | null = null;
  let redirectNext = false;
  let heredocNext: { strip: boolean } | null = null;

  const append = (s: string) => {
    word = (word ?? "") + s;
  };

  const endWord = () => {
    if (word === null) return;
    if (heredocNext) {
      pending.push({ delim: word, strip: heredocNext.strip, cmd });
      heredocNext = null;
    } else if (redirectNext) {
      cmd.redirects.push(word);
      redirectNext = false;
    } else {
      cmd.words.push(word);
    }
    word = null;
  };

  const endCommand = () => {
    endWord();
    const used = cmd.words.length > 0 || cmd.redirects.length > 0 || pending.some((p) => p.cmd === cmd);
    if (used) commands.push(cmd);
    cmd = empty();
    redirectNext = false;
    heredocNext = null;
  };

  /** 対になる ) の位置。引用符の中の ( ) は数えない。見つからなければ文の終わり */
  const parenEnd = (start: number): number => {
    let depth = 1;
    let j = start;
    while (j < n) {
      const d = src[j];
      if (d === "'" || d === '"') {
        const close = src.indexOf(d, j + 1);
        j = close === -1 ? n : close + 1;
        continue;
      }
      if (d === esc) {
        j += 2;
        continue;
      }
      if (d === "(") depth++;
      if (d === ")" && --depth === 0) return j;
      j++;
    }
    return n;
  };

  /** Bash の ` の終わり */
  const backtickEnd = (start: number): number => {
    let j = start;
    while (j < n) {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (src[j] === "`") return j;
      j++;
    }
    return n;
  };

  /** $( ) を取り出し、語には元の文字のまま足す。戻りは ) の次 */
  const takeSubstitution = (at: number, into: (s: string) => void): number => {
    const end = parenEnd(at + 2);
    substitutions.push(src.slice(at + 2, end));
    into(src.slice(at, end + 1));
    return end + 1;
  };

  const takeBacktick = (at: number, into: (s: string) => void): number => {
    const end = backtickEnd(at + 1);
    substitutions.push(src.slice(at + 1, end));
    into(src.slice(at, end + 1));
    return end + 1;
  };

  /** " の中。戻りは閉じの " の次 */
  const readDouble = (start: number): number => {
    let buf = "";
    let j = start;
    while (j < n) {
      const d = src[j];
      if (d === '"') {
        if (dialect === "powershell" && src[j + 1] === '"') {
          buf += '"';
          j += 2;
          continue;
        }
        append(buf);
        return j + 1;
      }
      if (d === esc && j + 1 < n) {
        const e = src[j + 1];
        // Bash の " の中の \ は " \ $ ` 改行の前だけ逃がしで、ほかはそのまま残る
        if (dialect === "bash" && !'"\\$`\n'.includes(e)) buf += d;
        if (e !== "\n") buf += e;
        j += 2;
        continue;
      }
      if (d === "$" && src[j + 1] === "(") {
        j = takeSubstitution(j, (s) => (buf += s));
        continue;
      }
      if (dialect === "bash" && d === "`") {
        j = takeBacktick(j, (s) => (buf += s));
        continue;
      }
      buf += d;
      j++;
    }
    append(buf);
    return n;
  };

  /** 改行のあと、待っているヒアドキュメントの中身を順に読む。戻りは読み終えた位置 */
  const readHeredocs = (start: number): number => {
    let j = start;
    for (const h of pending.splice(0)) {
      const lines: string[] = [];
      while (j < n) {
        const nl = src.indexOf("\n", j);
        const stop = nl === -1 ? n : nl;
        let line = src.slice(j, stop).replace(/\r$/, "");
        j = nl === -1 ? n : nl + 1;
        if (h.strip) line = line.replace(/^\t+/, "");
        if (line === h.delim) break;
        lines.push(line);
      }
      h.cmd.heredocs.push(lines.join("\n"));
    }
    return j;
  };

  let i = 0;
  while (i < n) {
    const c = src[i];

    if (c === "\n" || c === "\r") {
      endCommand();
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      if (pending.length > 0) i = readHeredocs(i);
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      i++;
      continue;
    }
    if (c === "#" && word === null) {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "'") {
      const close = src.indexOf("'", i + 1);
      const stop = close === -1 ? n : close;
      append(src.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      i = readDouble(i + 1);
      continue;
    }
    if (c === esc) {
      if (src[i + 1] === "\n") {
        i += 2;
        continue;
      }
      if (src[i + 1] === "\r" && src[i + 2] === "\n") {
        i += 3;
        continue;
      }
      if (i + 1 < n) append(src[i + 1]);
      i += 2;
      continue;
    }
    if (dialect === "bash" && c === "`") {
      i = takeBacktick(i, append);
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      i = takeSubstitution(i, append);
      continue;
    }
    if (c === "&" && src[i + 1] === ">") {
      // &> と &>>: 標準出力と標準エラーの両方をファイルへ
      endWord();
      redirectNext = true;
      i += src[i + 2] === ">" ? 3 : 2;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      endCommand();
      i++;
      continue;
    }
    if (c === ">" || c === "<") {
      // 2> の 2 のような数字だけの語は、ファイルでなく番号
      if (word !== null && /^\d+$/.test(word)) word = null;
      else endWord();
      if (c === "<" && src[i + 1] === "<") {
        if (src[i + 2] === "<") {
          // <<< はその場の文字列。次の語はふつうの語として残す
          i += 3;
          continue;
        }
        const strip = src[i + 2] === "-";
        heredocNext = { strip };
        i += strip ? 3 : 2;
        continue;
      }
      let j = i + 1;
      if (src[j] === ">" || src[j] === "|") j++;
      if (src[j] === "&" && /[\d-]/.test(src[j + 1] ?? "")) {
        // >&2 や 2>&1 は番号の付け替えで、ファイルは無い
        j++;
        while (j < n && /[\d-]/.test(src[j])) j++;
        i = j;
        continue;
      }
      if (src[j] === "&") j++;
      redirectNext = true;
      i = j;
      continue;
    }

    append(c);
    i++;
  }
  endCommand();
  if (pending.length > 0) readHeredocs(n);

  return { commands, substitutions };
}
