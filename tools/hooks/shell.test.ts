import { describe, expect, it } from "vitest";
import { parse } from "./shell.ts";

const words = (src: string, dialect: "bash" | "powershell" = "bash") => parse(src, dialect).commands.map((c) => c.words);

describe("命令の分け方（Bash）", () => {
  it("改行・; && || | & ( ) で分ける", () => {
    expect(words("cd /c/x && npm test; git status | head\nls & (echo a) || true")).toEqual([
      ["cd", "/c/x"],
      ["npm", "test"],
      ["git", "status"],
      ["head"],
      ["ls"],
      ["echo", "a"],
      ["true"],
    ]);
  });

  it("引用符の中は 1 語のまま（中の && や ; で分けない）", () => {
    expect(words(`git commit -m "a && b; wrangler deploy" -m 'c | d'`)).toEqual([
      ["git", "commit", "-m", "a && b; wrangler deploy", "-m", "c | d"],
    ]);
  });

  it("\\ は次の 1 字を逃がす。\" の中では \" \\ $ ` の前だけ", () => {
    expect(words(String.raw`cat .de\v.vars "C:\Users\x" "a\"b"`)).toEqual([["cat", ".dev.vars", "C:\\Users\\x", 'a"b']]);
  });

  it("行の終わりの \\ は次の行へ続ける", () => {
    expect(words("npx wrangler \\\n  deploy")).toEqual([["npx", "wrangler", "deploy"]]);
  });

  it("# から行の終わりは見ない（語の途中の # は残す）", () => {
    expect(words("echo a#b # wrangler deploy\nls")).toEqual([["echo", "a#b"], ["ls"]]);
  });

  it("リダイレクトの行き先は words でなく redirects に。2> の 2 と 2>&1 は語にしない", () => {
    const [c] = parse("node x.mjs > out.txt 2> err.log 2>&1 >> all.log < in.txt &> both.log", "bash").commands;
    expect(c.words).toEqual(["node", "x.mjs"]);
    expect(c.redirects).toEqual(["out.txt", "err.log", "all.log", "in.txt", "both.log"]);
  });

  it("$( ) と ` ` の中は別の文として返す（\" の中でも）", () => {
    const p = parse('echo "$(cat a.txt)" `wrangler whoami` $(ls $(pwd))', "bash");
    // 入れ子の $(pwd) は、rules.ts が "ls $(pwd)" をもう一度分けるときに出る
    expect(p.substitutions).toEqual(["cat a.txt", "wrangler whoami", "ls $(pwd)"]);
  });

  it("ヒアドキュメントの中身は命令にせず、その命令の heredocs に", () => {
    const p = parse("git commit -F - <<'EOF'\nwrangler deploy を止める\ngit push --force も\nEOF\ngit push origin HEAD", "bash");
    expect(p.commands.map((c) => c.words)).toEqual([
      ["git", "commit", "-F", "-"],
      ["git", "push", "origin", "HEAD"],
    ]);
    expect(p.commands[0].heredocs).toEqual(["wrangler deploy を止める\ngit push --force も"]);
  });

  it("<<- は行の頭のタブを外して終わりの印を探す。リダイレクトと一緒でも読む", () => {
    const p = parse("cat <<-END > .dev.vars\n\tKEY=1\n\tEND\nls", "bash");
    expect(p.commands[0].redirects).toEqual([".dev.vars"]);
    expect(p.commands[0].heredocs).toEqual(["KEY=1"]);
    expect(p.commands[1].words).toEqual(["ls"]);
  });

  it("CRLF の改行も分ける", () => {
    expect(words("npm test\r\ngit status\r\n")).toEqual([["npm", "test"], ["git", "status"]]);
  });
});

describe("命令の分け方（PowerShell）", () => {
  it("\\ はそのまま、` が逃がし", () => {
    expect(words('Get-Content C:\\Users\\x\\.dev.vars "a`"b"', "powershell")).toEqual([
      ["Get-Content", "C:\\Users\\x\\.dev.vars", 'a"b'],
    ]);
  });

  it("; | & で分け、\"\" は \" 1 つ", () => {
    expect(words(`& npx wrangler whoami; "a""b" | Out-File x.txt`, "powershell")).toEqual([
      ["npx", "wrangler", "whoami"],
      ['a"b'],
      ["Out-File", "x.txt"],
    ]);
  });

  it("$( ) の中は別の文", () => {
    expect(parse('Write-Output "$(Get-Content .env)"', "powershell").substitutions).toEqual(["Get-Content .env"]);
  });
});
