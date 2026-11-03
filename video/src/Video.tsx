// 3 分動画の本体。timeline.ts の場面と文を順に並べる。素材が無い所は仮の面で描く。
// 絵（shot）は前後で 10 コマ重ね、前の絵が薄くなる間に次の絵が濃くなる（ぶつ切りにしない）。地の色が変わる所は地も 10 コマで混ぜる。
// 置き場所は 3 段: 上の見出しの帯（道具の段だけ）→ 舞台 → 字幕の帯。注記は決まった隅に（parts/Overlay.tsx）。
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { type Assets, audioPath, useAssets } from "./assets";
import { GroundProvider, usePalette } from "./ground";
import { Footage } from "./parts/Footage";
import { Framed, framedSize } from "./parts/Frame";
import { Bars, BigNumber, EndCard, Flow, Memo, Models, Quote, Ring72, Rules, Stage, TextCard, Title } from "./parts/Graphics";
import { CROSS, STAGGER, mix, progress, rise } from "./parts/motion";
import { Caption, Header, Subtitle } from "./parts/Overlay";
import { COLOR, FONT, LAYOUT, TYPE, palette } from "./theme";
import { FPS, LINES, SCENES, type Scene, type Shot } from "./timeline";

const f = (seconds: number) => Math.round(seconds * FPS);

/** 3 つの紙面の名前（F1。S4 の flow） */
const FLOW_NAMES = ["松山市の様式", "本人の 1 枚", "医療班の要約"];

/** 文字だけの面（split の中で録画の番号が空の所）。sub を「・」で分けて 1 行ずつ出す */
const WordsPanel: React.FC<{ width: number; height: number; text: string }> = ({ width, height, text }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <div
      style={{
        width,
        height,
        background: p.surface,
        color: p.onSurface,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "0 64px",
        boxSizing: "border-box",
        gap: 26,
        fontFamily: FONT.main,
        fontSize: TYPE.h2,
        fontWeight: 600,
      }}
    >
      {text.split("・").map((w, i) => (
        <div key={w} style={{ display: "flex", alignItems: "center", gap: 20, ...rise(frame, 8 + i * STAGGER * 2) }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: p.onSurface, flex: "none" }} />
          {w}
        </div>
      ))}
    </div>
  );
};

/** 録画を横に並べる（split）。スマホは舞台の高さいっぱい、窓は残りの幅を分ける。lines[i] を各録画の上の見出しに */
const Split: React.FC<{ shot: Shot; assets: Assets; duration: number }> = ({ shot, assets, duration }) => {
  const frame = useCurrentFrame();
  const ids = shot.footages ?? [];
  const gap = 56;
  const heading = shot.lines?.length ? 64 : 0;
  const H = LAYOUT.stage.height - heading - 40;
  const phoneW = ids.map((id) => (id ? framedSize(id, 10000, H) : null)).map((s) => (s?.phone ? s.width : 0));
  const windows = ids.filter((_, i) => phoneW[i] === 0).length;
  const restW = LAYOUT.stage.width - phoneW.reduce((a, b) => a + b, 0) - gap * (ids.length - 1);
  const eachW = windows ? restW / windows : 0;
  return (
    <Stage row gap={gap}>
      {ids.map((id, i) => {
        const size = id ? framedSize(id, phoneW[i] || eachW, H) : { width: eachW, height: Math.round((eachW * 9) / 16) + LAYOUT.windowBar };
        return (
          <div key={`${id}-${i}`} style={{ width: size.width, display: "flex", flexDirection: "column", alignItems: "center" }}>
            {shot.lines?.[i] ? (
              <div style={{ fontSize: TYPE.h2, fontWeight: 600, marginBottom: 20, ...rise(frame, i * STAGGER) }}>{shot.lines[i]}</div>
            ) : null}
            {id ? (
              <Framed
                id={id}
                assets={assets}
                maxWidth={size.width}
                maxHeight={size.height}
                from={shot.froms?.[i] ?? shot.from}
                duration={duration}
                note={shot.label}
                delay={i * STAGGER}
                callouts={i === ids.length - 1 ? shot.callouts : undefined}
              />
            ) : (
              <WordsPanel width={size.width} height={size.height} text={shot.sub ?? ""} />
            )}
          </div>
        );
      })}
    </Stage>
  );
};

/** 端末の録画を順に切り替える（S7 の右） */
const Cycle: React.FC<{ ids: string[]; assets: Assets; duration: number; label: string }> = ({ ids, assets, duration, label }) => {
  const frame = useCurrentFrame();
  const each = Math.max(1, Math.floor(duration / Math.max(1, ids.length)));
  const i = Math.min(ids.length - 1, Math.floor(frame / each));
  return (
    <Sequence from={i * each} layout="none">
      <Framed id={ids[i] ?? ""} assets={assets} maxWidth={860} maxHeight={524} duration={each} note={label} />
    </Sequence>
  );
};

/** 奥に敷く物。背景の生成動画（B01…、scripts/bg.mjs でぼかして色を抜いた連番）があればそれ、無ければぼかした録画 */
const Backdrop: React.FC<{ shot: Shot; assets: Assets; duration: number }> = ({ shot, assets, duration }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const count = shot.bg ? (assets.bg?.[shot.bg] ?? 0) : 0;
  if (count > 0) {
    const index = Math.min(count, frame + 1);
    return (
      <AbsoluteFill>
        <Img src={staticFile(`bg/${shot.bg}/${String(index).padStart(5, "0")}.jpg`)} style={{ width: 1920, height: 1080, objectFit: "cover", filter: "grayscale(1)" }} />
        <AbsoluteFill style={{ background: p.bg, opacity: 0.74 }} />
      </AbsoluteFill>
    );
  }
  if (shot.footage && (assets.footage[shot.footage] ?? 0) > 0) {
    return (
      <AbsoluteFill style={{ opacity: 0.16 * progress(frame, 0, 20) }}>
        <Footage id={shot.footage} assets={assets} width={1920} height={1080} blur={16} duration={duration} />
      </AbsoluteFill>
    );
  }
  return null;
};

const ShotView: React.FC<{ shot: Shot; assets: Assets }> = ({ shot, assets }) => {
  const duration = f(shot.end) - f(shot.at);
  const S = LAYOUT.stage;
  let body: React.ReactNode = null;
  switch (shot.kind) {
    case "footage":
      body = (
        <Stage>
          <Framed
            id={shot.footage ?? ""}
            assets={assets}
            maxWidth={S.width}
            maxHeight={S.height}
            from={shot.from}
            rate={shot.rate}
            zoom={shot.zoom}
            duration={duration}
            note={shot.label}
            chip={shot.chip}
            callouts={shot.callouts}
          />
        </Stage>
      );
      break;
    case "split":
      body = <Split shot={shot} assets={assets} duration={duration} />;
      break;
    case "title":
      body = <Title title={shot.lines?.[0] ?? ""} sub={shot.sub} />;
      break;
    case "text":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <TextCard lines={shot.lines ?? []} sub={shot.sub} beats={shot.beats} />
        </>
      );
      break;
    case "ring":
      body = <Ring72 label={shot.lines?.[0] ?? "72 時間"} duration={duration} sub={shot.sub} />;
      break;
    case "number":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <BigNumber value={shot.value ?? ""} sub={shot.sub} />
        </>
      );
      break;
    case "bars":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <Bars />
        </>
      );
      break;
    case "memo":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <Memo />
        </>
      );
      break;
    case "flow":
      body = (
        <Flow names={FLOW_NAMES} cardWidth={528}>
          {(shot.footages ?? []).map((id, i) => (
            <Framed key={id} id={id} assets={assets} maxWidth={528} maxHeight={600} from={shot.froms?.[i] ?? shot.from} duration={duration} note={shot.label} delay={14 + i * 8} />
          ))}
        </Flow>
      );
      break;
    case "rules":
      body = <Rules />;
      break;
    case "models":
      body = (
        <Models counters={shot.lines}>
          <Cycle ids={shot.footages ?? []} assets={assets} duration={duration} label={shot.label} />
        </Models>
      );
      break;
    case "quote":
      body = <Quote text={shot.lines?.[0] ?? ""} sub={shot.sub} />;
      break;
    case "end":
      body = <EndCard />;
      break;
  }
  const image = shot.bg && (assets.bg?.[shot.bg] ?? 0) > 0 ? "イメージ（AI 生成）" : shot.kind === "memo" ? "イメージ" : null;
  return (
    <AbsoluteFill>
      {body}
      {shot.kind === "footage" && shot.sub ? <Caption text={shot.sub} corner="bottomLeft" /> : null}
      {shot.source ? <Caption text={`出典 ${shot.source}`} corner="bottomLeft" /> : null}
      {image ? <Caption text={image} corner="bottomRight" /> : null}
      {showsApp(shot) ? <Caption text="利用者は架空" corner="topRight" /> : null}
      <AppAudio shot={shot} assets={assets} />
    </AbsoluteFill>
  );
};

/**
 * アプリの画面（録画 R01〜R19）が映る絵か。映る間だけ「利用者は架空」を出す。
 * 数字の画面に出すと、出典のある本物の数字まで架空に見えるため。端末の録画（R20〜）は利用者を映さない
 */
function showsApp(shot: Shot): boolean {
  if (shot.kind === "text") return false; // ぼかした奥の録画は読めない
  return [shot.footage, ...(shot.footages ?? [])].some((id) => !!id && /^R(0[1-9]|1\d)$/.test(id));
}

/** 録画から抜いたアプリの音（着信・問いかけ・録音）。速さを変えた所では鳴らさない */
const AppAudio: React.FC<{ shot: Shot; assets: Assets }> = ({ shot, assets }) => {
  if (shot.kind !== "footage" || !shot.footage || (shot.rate ?? 1) !== 1) return null;
  const path = audioPath(assets, `audio/app/${shot.footage}`);
  if (!path) return null;
  return <Audio src={staticFile(path)} trimBefore={f(shot.from ?? 0)} volume={0.9} />;
};

/** 絵 1 つ。前後の CROSS コマで薄くなる・濃くなる */
const Faded: React.FC<{ length: number; fadeIn: boolean; fadeOut: boolean; children: React.ReactNode }> = ({ length, fadeIn, fadeOut, children }) => {
  const frame = useCurrentFrame();
  const a = fadeIn ? progress(frame, 0, CROSS) : 1;
  const b = fadeOut ? 1 - progress(frame, length - CROSS, CROSS) : 1;
  return <AbsoluteFill style={{ opacity: Math.min(a, b) }}>{children}</AbsoluteFill>;
};

/** 地の色。場面の頭で前の場面と地が違えば CROSS コマで混ぜる */
const GroundLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const i = Math.max(0, SCENES.findIndex((s) => frame < f(s.end)));
  const scene = SCENES[i] ?? SCENES[SCENES.length - 1];
  const prev = SCENES[i - 1];
  const now = palette(scene.ground).bg;
  if (!prev || prev.ground === scene.ground) return <AbsoluteFill style={{ background: now }} />;
  const t = progress(frame - f(scene.at), 0, CROSS);
  return <AbsoluteFill style={{ background: mix(palette(prev.ground).bg, now, t) }} />;
};

/** 道具の段（S4〜S7）の見出しの帯。段の名前と 72 時間の線 */
const TOOL_SCENES: Record<string, { title: string; state: string; hours: (t: number) => number | null }> = {
  S4: { title: "計画", state: "平時", hours: () => 0 },
  S5: { title: "訓練", state: "早送り", hours: (t) => t * 72 },
  S6: { title: "発災時", state: "大雨", hours: (t) => 1 + t * 2 },
  S7: { title: "使い分け", state: "Claude Code", hours: () => null },
};

const ToolHeader: React.FC = () => {
  const frame = useCurrentFrame();
  const start = f(SCENES.find((s) => s.id === "S4")?.at ?? 0);
  const abs = frame + start;
  const scene = SCENES.find((s) => abs >= f(s.at) && abs < f(s.end));
  const info = scene ? TOOL_SCENES[scene.id] : undefined;
  if (!scene || !info) return null;
  const t = (abs - f(scene.at)) / Math.max(1, f(scene.end) - f(scene.at));
  return (
    <GroundProvider ground={scene.ground}>
      <Header title={info.title} state={info.state} hours={info.hours(t)} />
    </GroundProvider>
  );
};

/** 音楽の大きさ。声のある所と強調の所で下げる（強調は一番下げる） */
function musicVolume(frame: number): number {
  const s = frame / FPS;
  for (const scene of SCENES) for (const shot of scene.shots) if (shot.emphasis && s >= shot.at && s < shot.end) return 0.05;
  for (const line of LINES) if (s >= line.at - 0.2 && s < line.end + 0.2) return 0.12;
  return 0.3;
}

const sceneOf = (seconds: number): Scene => SCENES.find((s) => seconds >= s.at && seconds < s.end) ?? SCENES[0];

export const Care72Video: React.FC<{ showEn: boolean }> = ({ showEn }) => {
  const assets = useAssets();
  const music = audioPath(assets, "audio/music/bed");
  const shots = SCENES.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
  const tools = SCENES.filter((s) => TOOL_SCENES[s.id]);
  const toolFrom = f(tools[0]?.at ?? 0);
  const toolTo = f(tools[tools.length - 1]?.end ?? 0);
  return (
    <AbsoluteFill style={{ background: COLOR.blue, fontFamily: FONT.main }}>
      <GroundLayer />
      {shots.map(({ scene, shot }, k) => {
        const length = f(shot.end) - f(shot.at);
        const last = k === shots.length - 1;
        const extended = length + (last ? 0 : CROSS);
        return (
          <Sequence key={`${shot.at}`} from={f(shot.at)} durationInFrames={extended} name={`${scene.id} ${shot.label}`}>
            <GroundProvider ground={scene.ground}>
              <Faded length={extended} fadeIn={k > 0} fadeOut={!last}>
                <ShotView shot={shot} assets={assets} />
              </Faded>
            </GroundProvider>
          </Sequence>
        );
      })}
      {toolTo > toolFrom ? (
        <Sequence from={toolFrom} durationInFrames={toolTo - toolFrom} name="見出しの帯">
          <ToolHeader />
        </Sequence>
      ) : null}
      {LINES.map((line) => {
        const duration = f(line.end) - f(line.at);
        const voice = audioPath(assets, `audio/narration/${line.id}`);
        return (
          <Sequence key={line.id} from={f(line.at)} durationInFrames={duration} name={line.id}>
            <GroundProvider ground={sceneOf(line.at).ground}>
              <Subtitle line={line} duration={duration} showEn={showEn} />
            </GroundProvider>
            {voice ? <Audio src={staticFile(voice)} /> : null}
          </Sequence>
        );
      })}
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
