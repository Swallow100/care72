// やさしい日本語の言葉（lib/forms/easy-words.ts の Word）を描く。ふりがなは <ruby>（読めない環境では（ ）で出る）。
// 本人の 1 枚の紙面（T06）と、本人のスマホの普段の画面（T10）が同じ部品を使う。状態を持たない。

import { Fragment } from "react";
import type { Word } from "@/lib/forms/easy-words";

export function EasyWords({ words }: { words: readonly Word[] }) {
  return (
    <>
      {words.map((w, i) => {
        const body = w.ruby ? (
          <ruby>
            {w.text}
            <rp>（</rp>
            <rt>{w.ruby}</rt>
            <rp>）</rp>
          </ruby>
        ) : (
          w.text
        );
        return w.strong ? <strong key={i}>{body}</strong> : <Fragment key={i}>{body}</Fragment>;
      })}
    </>
  );
}
