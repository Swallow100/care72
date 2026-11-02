// 書き出す動画の登録。Care72 は英語の字幕つき、Care72Ja は日本語の字幕だけ（どちらを出すかは作者の判断）。
import React from "react";
import { Composition } from "remotion";
import { loadFonts } from "./fonts";
import { FPS, HEIGHT, TOTAL_SECONDS, WIDTH } from "./timeline";
import { Care72Video } from "./Video";

loadFonts();

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Care72"
      component={Care72Video}
      durationInFrames={FPS * TOTAL_SECONDS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ showEn: true }}
    />
    <Composition
      id="Care72Ja"
      component={Care72Video}
      durationInFrames={FPS * TOTAL_SECONDS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ showEn: false }}
    />
  </>
);
