// 3 分動画の本体。timeline.ts の場面と文を順に並べる。素材が無い所は仮の面で描く。
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { type Assets, audioPath, useAssets } from "./assets";
import { GroundProvider, usePalette } from "./ground";
import { Footage } from "./parts/Footage";
import { Bars, BigNumber, EndCard, Flow, Memo, Models, Quote, Ring72, Rules, TextCard, Title } from "./parts/Graphics";
import { Chip, Emphasis, Fictional, Source, Subtitle, TopLine } from "./parts/Overlay";
import { COLOR, FONT, LAYOUT, palette } from "./theme";
import { FPS, LINES, SCENES, type Scene, type Shot } from "./timeline";

const f = (seconds: number) => Math.round(seconds * FPS);

/** 3 つの紙面の名前（F1。S4 の flow） */
const FLOW_NAMES = ["松山市の様式", "本人の 1 枚", "医療班の要約"];

/** 文字だけの面（split の中で録画の番号が空の所）。sub を「・」で分けて並べる */
const WordsPanel: React.FC<{ width: number; height: number; text: string }> = ({ width, height, text }) => {
  const p = usePalette();
  return (
    <div
      style={{
        width,
        height,
        background: p.surface,
        color: p.onSurface,
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 18,
        fontFamily: FONT.main,
        fontSize: 44,
        fontWeight: 600,
      }}
    >
      {text.split("・").map((w) => (
        <div key={w}>{w}</div>
      ))}
    </div>
  );
};

/** 録画を横に並べる（split）。lines[i] を各録画の上の見出しに */
const Split: React.FC<{ shot: Shot; assets: Assets; duration: number }> = ({ shot, assets, duration }) => {
  const p = usePalette();
  const ids = shot.footages ?? [];
  const gap = 30;
  const width = (LAYOUT.footage.width - gap * (ids.length - 1)) / ids.length;
  const height = Math.round((width * 9) / 16);
  const top = LAYOUT.footage.top + Math.max(0, (LAYOUT.footage.height - 150 - height) / 2);
  return (
    <div style={{ position: "absolute", left: LAYOUT.footage.left, top, display: "flex", gap }}>
      {ids.map((id, i) => (
        <div key={`${id}-${i}`} style={{ width }}>
          {shot.lines?.[i] ? (
            <div style={{ fontFamily: FONT.main, fontSize: 44, fontWeight: 600, color: p.fg, marginBottom: 14, textAlign: "center" }}>
              {shot.lines[i]}
            </div>
          ) : null}
          {id ? (
            <Footage id={id} assets={assets} width={width} height={height} from={shot.from} duration={duration} note={shot.label} />
          ) : (
            <WordsPanel width={width} height={height} text={shot.sub ?? ""} />
          )}
        </div>
      ))}
    </div>
  );
};

/** 端末の録画を順に切り替える（S7 の右） */
const Cycle: React.FC<{ ids: string[]; assets: Assets; duration: number; label: string }> = ({ ids, assets, duration, label }) => {
  const frame = useCurrentFrame();
  const each = Math.max(1, Math.floor(duration / Math.max(1, ids.length)));
  const i = Math.min(ids.length - 1, Math.floor(frame / each));
  return <Footage id={ids[i] ?? ""} assets={assets} width={860} height={484} from={(frame - i * each) / FPS} note={label} />;
};

const ShotView: React.FC<{ shot: Shot; assets: Assets }> = ({ shot, assets }) => {
  const duration = f(shot.end) - f(shot.at);
  const F = LAYOUT.footage;
  let body: React.ReactNode = null;
  switch (shot.kind) {
    case "footage":
      body = (
        <div style={{ position: "absolute", left: F.left, top: F.top }}>
          <Footage
            id={shot.footage ?? ""}
            assets={assets}
            width={F.width}
            height={F.height}
            from={shot.from}
            rate={shot.rate}
            zoom={shot.zoom}
            duration={duration}
            note={shot.label}
          />
        </div>
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
          {shot.footage && (assets.footage[shot.footage] ?? 0) > 0 ? (
            <div style={{ position: "absolute", left: F.left, top: F.top, opacity: 0.25 }}>
              <Footage id={shot.footage} assets={assets} width={F.width} height={F.height} blur={14} duration={duration} />
            </div>
          ) : null}
          <TextCard lines={shot.lines ?? []} sub={shot.sub} />
        </>
      );
      break;
    case "ring":
      body = <Ring72 label={shot.lines?.[0] ?? "72 時間"} duration={duration} />;
      break;
    case "number":
      body = <BigNumber value={shot.value ?? ""} sub={shot.sub} />;
      break;
    case "bars":
      body = <Bars />;
      break;
    case "memo":
      body = <Memo />;
      break;
    case "flow":
      body = (
        <Flow names={FLOW_NAMES}>
          {(shot.footages ?? []).map((id) => (
            <Footage key={id} id={id} assets={assets} width={540} height={304} duration={duration} note={shot.label} />
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
  return (
    <AbsoluteFill>
      {body}
      {shot.kind === "footage" && shot.sub ? <Source text={shot.sub} /> : null}
      {shot.source ? <Source text={shot.source} /> : null}
      {shot.chip ? <Chip text={shot.chip} /> : null}
      {shot.emphasis ? <Emphasis /> : null}
      {showsApp(shot) ? <Fictional /> : null}
      <AppAudio shot={shot} assets={assets} />
    </AbsoluteFill>
  );
};

/**
 * アプリの画面（録画 R01〜R19）が映る絵か。映る間だけ「利用者は架空」を出す。
 * 数字の画面に出すと、出典のある本物の数字まで架空に見えるため。端末の録画（R20〜）は利用者を映さない
 */
function showsApp(shot: Shot): boolean {
  return [shot.footage, ...(shot.footages ?? [])].some((id) => !!id && /^R(0[1-9]|1\d)$/.test(id));
}

/** 録画から抜いたアプリの音（着信・問いかけ・録音）。速さを変えた所では鳴らさない */
const AppAudio: React.FC<{ shot: Shot; assets: Assets }> = ({ shot, assets }) => {
  if (shot.kind !== "footage" || !shot.footage || (shot.rate ?? 1) !== 1) return null;
  const path = audioPath(assets, `audio/app/${shot.footage}`);
  if (!path) return null;
  return <Audio src={staticFile(path)} trimBefore={f(shot.from ?? 0)} volume={0.9} />;
};

/** 上の 72 時間の線（S4〜S6 だけ） */
const SceneTopLine: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const t = frame / Math.max(1, f(scene.end) - f(scene.at));
  if (scene.id === "S4") return <TopLine progress={0} label="平時" />;
  if (scene.id === "S5") return <TopLine progress={t} label="訓練 0〜72 時間" />;
  if (scene.id === "S6") return <TopLine progress={0.04 + t * 0.04} label="発災時" />;
  return null;
};

const SceneView: React.FC<{ scene: Scene; assets: Assets }> = ({ scene, assets }) => (
  <GroundProvider ground={scene.ground}>
    <AbsoluteFill style={{ background: palette(scene.ground).bg, fontFamily: FONT.main }}>
      {scene.shots.map((shot) => (
        <Sequence key={`${shot.at}`} from={f(shot.at) - f(scene.at)} durationInFrames={f(shot.end) - f(shot.at)} name={shot.label}>
          <ShotView shot={shot} assets={assets} />
        </Sequence>
      ))}
      <SceneTopLine scene={scene} />
    </AbsoluteFill>
  </GroundProvider>
);

/** 音楽の大きさ。声のある所と強調の所で下げる（強調は一番下げる） */
function musicVolume(frame: number): number {
  const s = frame / FPS;
  for (const scene of SCENES) for (const shot of scene.shots) if (shot.emphasis && s >= shot.at && s < shot.end) return 0.05;
  for (const line of LINES) if (s >= line.at - 0.2 && s < line.end + 0.2) return 0.12;
  return 0.3;
}

export const Care72Video: React.FC<{ showEn: boolean }> = ({ showEn }) => {
  const assets = useAssets();
  const music = audioPath(assets, "audio/music/bed");
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      {SCENES.map((scene) => (
        <Sequence key={scene.id} from={f(scene.at)} durationInFrames={f(scene.end) - f(scene.at)} name={`${scene.id} ${scene.title}`}>
          <SceneView scene={scene} assets={assets} />
        </Sequence>
      ))}
      {LINES.map((line) => {
        const duration = f(line.end) - f(line.at);
        const scene = SCENES.find((s) => line.at >= s.at && line.at < s.end) ?? SCENES[0];
        const voice = audioPath(assets, `audio/narration/${line.id}`);
        return (
          <Sequence key={line.id} from={f(line.at)} durationInFrames={duration} name={line.id}>
            <Subtitle line={line} duration={duration} showEn={showEn} ground={scene.ground} />
            {voice ? <Audio src={staticFile(voice)} /> : null}
          </Sequence>
        );
      })}
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
