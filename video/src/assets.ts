// 素材の有無。scripts/scan.mjs が public/assets.json に書く（録画の連番の枚数と、音のファイルの一覧）。
// 無い素材は仮の面で描くので、素材がそろう前から通しで見られる。
import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

export type Assets = {
  /** 録画の番号 → 連番の枚数（public/footage/<番号>/00001.jpg …） */
  footage: Record<string, number>;
  /** public の下の音のファイル（audio/narration/N01.wav など） */
  audio: string[];
};

const EMPTY: Assets = { footage: {}, audio: [] };

export function useAssets(): Assets {
  const [assets, setAssets] = useState<Assets>(EMPTY);
  const [handle] = useState(() => delayRender("素材の一覧の読み込み"));
  useEffect(() => {
    let alive = true;
    fetch(staticFile("assets.json"))
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((a: Partial<Assets>) => {
        if (alive) setAssets({ footage: a.footage ?? {}, audio: a.audio ?? [] });
      })
      .catch(() => undefined)
      .finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [handle]);
  return assets;
}

/** 音のファイルがあればその道（wav か mp3）、無ければ null */
export function audioPath(assets: Assets, base: string): string | null {
  for (const ext of [".wav", ".mp3", ".m4a"]) {
    if (assets.audio.includes(base + ext)) return base + ext;
  }
  return null;
}
