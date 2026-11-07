// 3 分動画の本体。timeline.ts の場面と文を順に並べる。素材が無い所は仮の面で描く。
// 絵（shot）は前後で 10 コマ重ね、前の絵が薄くなる間に次の絵が濃くなる（ぶつ切りにしない）。地の色が変わる所は地も 10 コマで混ぜる。
// 置き場所は 3 段: 上の見出しの帯（道具の段だけ）→ 舞台 → 字幕の帯。注記は決まった隅に（parts/Overlay.tsx）。
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { type Assets, audioPath, useAssets } from "./assets";
import { GroundProvider, usePalette } from "./ground";
import { Footage } from "./parts/Footage";
import { Framed, framedSize } from "./parts/Frame";
import { BigNumber, Compare, EndCard, Flow, Memo, Models, Quote, Plate, Rules, Share, Stage, Survey, TextCard, Title } from "./parts/Graphics";
import { Carousel, carouselHead } from "./parts/Carousel";
import { Kinetic, type KineticWord } from "./parts/Kinetic";
import { LogoClock } from "./parts/LogoClock";
import { Marker } from "./parts/Marker";
import { CROSS, EASE_IN_OUT, STAGGER, progress, rise } from "./parts/motion";
import { Caption, Header, Subtitle } from "./parts/Overlay";
import { COLOR, FONT, LAYOUT, TYPE, palette } from "./theme";
import { FPS, LINES, SCENES, type Cue, type Scene, type Shot } from "./timeline";
import { sayAt } from "./voice";

const f = (seconds: number) => Math.round(seconds * FPS);

const LINE_BY_ID = new Map(LINES.map((l) => [l.id, l]));

/** 言葉を出すコマ（絵の頭から）。声が say を言い始める所（src/voice.ts）。文の中に無い言葉は絵の頭（check.mjs が止める） */
function cueFrame(cue: Cue, shot: Shot, assets: Assets): number {
  const line = LINE_BY_ID.get(cue.line);
  const at = line ? sayAt(line, assets.voice?.[cue.line], cue.say ?? cue.text) : null;
  return at === null ? 0 : f(at + (cue.shift ?? 0) - shot.at);
}

/** 文字が主役の絵の言葉（slot の無い物）。row が無ければ 1 つずつ別の行 */
function kineticWords(shot: Shot, assets: Assets): KineticWord[] {
  return (shot.cues ?? [])
    .filter((c) => !c.slot)
    .map((c, i) => ({ text: c.text, frame: cueFrame(c, shot, assets), size: c.size ?? "h1", row: c.row ?? i, hold: c.hold, mark: c.mark }));
}

/** 声がその言葉を言うコマ（slot が mark の言葉を順に）。字は出さず、画面の物を出す・強調する時刻に使う（72 時間の輪の題名の数、前と後の 2 つの数） */
function markFrames(shot: Shot, assets: Assets): number[] {
  return (shot.cues ?? []).filter((c) => c.slot === "mark").map((c) => cueFrame(c, shot, assets));
}

/** 数字の画面の数の上（lead）と後ろ（tail）の言葉 */
function slotWord(shot: Shot, assets: Assets, slot: "lead" | "tail") {
  const c = shot.cues?.find((x) => x.slot === slot);
  return c ? { text: c.text, frame: cueFrame(c, shot, assets), size: c.size ?? "h1" } : undefined;
}

/** 終わりの画面に出すリポジトリ（公開用の repo の名前が決まったらここを直す） */
const REPO = "github.com/Swallow100/care72";

/** 「12 人中 9 人」を割合の図に（アンケート。人数が少ないので割合でなく人数で言う）。数が［ ］のうちは字だけ（塗りなし） */
function peopleShare(value: string, part: string, whole: string) {
  const m = /(\d+)\s*人中\s*(\d+)\s*人/.exec(value);
  if (!m) return { hero: value, share: 0, part, whole };
  return { hero: `${m[2]} 人`, share: Number(m[2]) / Number(m[1]), part, whole: whole || `答えた ${m[1]} 人` };
}

/** 「4 人中 4 人」の答えた人数 */
function peopleTotal(value?: string): number {
  return Number(/(\d+)\s*人中/.exec(value ?? "")?.[1] ?? 1) || 1;
}

/** 3 つの紙面の名前（F1。S4 の flow） */
const FLOW_NAMES = ["松山市の様式", "本人保管書類", "医療班の要約"];

/** 文字だけの面（split の中で録画の番号が空の所）。sub を「・」で分けて 1 行ずつ出す */
const WordsPanel: React.FC<{ width: number; height: number; text: string; delay?: number; bg?: { id: string; count: number } }> = ({ width, height, text, delay = 0, bg }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        width,
        height,
        ...rise(frame, delay),
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
      {/* 背景の生成動画は文字の面の中だけ（録画の後ろには敷かない）。色を抜いて面の色を重ねる */}
      {bg ? (
        <AbsoluteFill>
          <Img src={staticFile(`bg/${bg.id}/${String(Math.min(bg.count, frame + 1)).padStart(5, "0")}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1) brightness(0.5)" }} />
          <AbsoluteFill style={{ background: p.surface, opacity: 0.8 }} />
        </AbsoluteFill>
      ) : null}
      {text.split("・").map((w, i) => (
        <div key={w} style={{ position: "relative", display: "flex", alignItems: "center", gap: 20, ...rise(frame, delay + 8 + i * STAGGER * 2) }}>
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
  const p = usePalette();
  const ids = shot.footages ?? [];
  // beats があれば見出しと録画を声に合わせて 1 つずつ出す（S2 の「計画・訓練・発災時」）
  const delays = ids.map((_, i) => (shot.beats?.[i] !== undefined ? f(shot.beats[i]) : i * STAGGER));
  const cross = !!shot.cross && ids.length === 2;
  const gap = cross ? 28 : 56;
  const CROSS_W = 130;
  // 話の段（青地）の見出しは 1 段大きく（見出しそのものが話の強調）
  const headingSize = p.bg === COLOR.blue ? TYPE.h1 : TYPE.h2;
  const heading = shot.lines?.length ? headingSize + 20 : 0;
  const H = LAYOUT.stage.height - heading - 40;
  // 録画の番号が空の所: cues があれば言葉（地の上にじかに、決まった幅）、無ければ文字の面
  const words = shot.cues?.length ? kineticWords(shot, assets) : null;
  const TEXT_W = 600;
  const textW: number[] = ids.map((id) => (!id && words ? TEXT_W : 0));
  const phoneW = ids.map((id) => (id ? framedSize(id, 10000, H) : null)).map((s) => (s?.phone ? s.width : 0));
  const windows = ids.filter((id, i) => phoneW[i] === 0 && textW[i] === 0).length;
  const restW = LAYOUT.stage.width - phoneW.reduce((a, b) => a + b, 0) - textW.reduce((a, b) => a + b, 0) - gap * (ids.length - 1) - (cross ? CROSS_W + gap : 0);
  const eachW = windows ? restW / windows : 0;
  return (
    <Stage row gap={gap}>
      {ids.map((id, i) => {
        if (!id && words) {
          return (
            <div key={`text-${i}`} style={{ width: TEXT_W, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <Kinetic words={words} marker={shot.marker} duration={duration} exit />
            </div>
          );
        }
        const size = id ? framedSize(id, phoneW[i] || eachW, H) : { width: eachW, height: Math.round((eachW * 9) / 16) + LAYOUT.windowBar };
        const panel = (
          <div key={`${id}-${i}`} style={{ width: size.width, display: "flex", flexDirection: "column", alignItems: "center" }}>
            {shot.lines?.[i] ? (
              <div style={{ fontSize: headingSize, fontWeight: 600, marginBottom: 20, ...rise(frame, delays[i]) }}>
                {/* 見出しが白い帯の言葉なら、出てから帯を引く */}
                {shot.lines[i] === shot.marker ? <Marker at={delays[i] + 12}>{shot.lines[i]}</Marker> : shot.lines[i]}
              </div>
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
                delay={delays[i]}
                callouts={i === ids.length - 1 ? shot.callouts : undefined}
              />
            ) : (
              <WordsPanel
                width={size.width}
                height={size.height}
                text={shot.sub ?? ""}
                delay={delays[i]}
                bg={shot.bg && (assets.bg?.[shot.bg] ?? 0) > 0 ? { id: shot.bg, count: assets.bg?.[shot.bg] ?? 0 } : undefined}
              />
            )}
          </div>
        );
        return cross && i === 1 ? (
          <React.Fragment key="cross">
            <CrossArrow at={delays[1]} width={CROSS_W} top={heading} />
            {panel}
          </React.Fragment>
        ) : (
          panel
        );
      })}
    </Stage>
  );
};

/** 左から右への矢印と、真ん中の赤い ×（知っているのに書けていない） */
const CrossArrow: React.FC<{ at: number; width: number; top: number }> = ({ at, width, top }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const draw = progress(frame, at - 6, 10);
  const x = progress(frame, at + 2, 8);
  const c = 26;
  return (
    <div style={{ width, alignSelf: "stretch", paddingTop: top, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={width} height={80} viewBox={`0 0 ${width} 80`} style={{ overflow: "visible" }}>
        <line x1={4} y1={40} x2={4 + (width - 22) * draw} y2={40} stroke={p.fg} strokeWidth={5} strokeLinecap="round" />
        <path d={`M ${width - 22} 26 L ${width - 4} 40 L ${width - 22} 54`} fill="none" stroke={p.fg} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={draw >= 1 ? 1 : 0} />
        <g opacity={x} transform={`translate(${width / 2} 40) scale(${0.6 + 0.4 * x})`}>
          <circle r={c + 6} fill={COLOR.urgent} />
          <path d={`M ${-c / 2} ${-c / 2} L ${c / 2} ${c / 2} M ${c / 2} ${-c / 2} L ${-c / 2} ${c / 2}`} stroke="#fff" strokeWidth={6} strokeLinecap="round" />
        </g>
      </svg>
    </div>
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
    const index = Math.min(count, f(shot.bgFrom ?? 0) + frame + 1);
    return (
      <AbsoluteFill>
        <Img src={staticFile(`bg/${shot.bg}/${String(index).padStart(5, "0")}.jpg`)} style={{ width: 1920, height: 1080, objectFit: "cover", filter: "grayscale(1) brightness(0.5)" }} />
        {/* 沈め方: 明るさ 0.5 に地の色を 80%。真っ白な所の上でも白い字 6.3:1、小さな字（onBlueSub）4.6:1（ぼかしは bg.mjs のまま） */}
        <AbsoluteFill style={{ background: p.bg, opacity: 0.8 }} />
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

/**
 * 録画の右下に重ねる数の面（声は足さず、字だけ。S6 の医療班の所のアンケートの問 7）。面の色は地の上で目立つ色（白地では青）、字はその逆。
 * 出るときは下から上がり、出たら止まる（跳ねない）。録画の大事な所（左の紙面）を隠さないよう右下に置く
 */
const StatNote: React.FC<{ stat: NonNullable<Shot["stat"]>; inset: { width: number; height: number; phone?: boolean } }> = ({ stat, inset }) => {
  const frame = useCurrentFrame();
  const p = usePalette();
  const S = LAYOUT.stage;
  return (
    <div
      style={{
        // 舞台（Stage）の中の位置。録画の窓（舞台の真ん中）の右下の角から 28px 内に重ねる
        position: "absolute",
        // スマホの録画は画面に重ねず、スマホの右の空いた所に（11/6）
        right: inset.phone ? (S.width - inset.width) / 2 - 600 - 56 : (S.width - inset.width) / 2 + 28,
        bottom: (S.height - inset.height) / 2 + 28,
        width: 600,
        boxSizing: "border-box",
        padding: "26px 32px",
        borderRadius: 10,
        background: p.strong,
        color: p.onStrong,
        fontFamily: FONT.main,
        ...rise(frame, f(stat.at), 18, 14),
      }}
    >
      <div style={{ fontSize: TYPE.caption, opacity: 0.85 }}>{stat.label}</div>
      {/* 文の中の「／」で改行する（語の途中で折らない） */}
      <div style={{ fontSize: TYPE.body, fontWeight: 600, marginTop: 8, lineHeight: 1.35, whiteSpace: "nowrap" }}>
        {stat.text.split("／").map((r) => (
          <div key={r}>{r}</div>
        ))}
      </div>
      {stat.value ? <div style={{ fontSize: TYPE.h1, fontWeight: 600, lineHeight: 1.1, marginTop: 6 }}>{stat.value}</div> : null}
    </div>
  );
};

const ShotView: React.FC<{ shot: Shot; assets: Assets; entryDelay?: number; next?: Shot }> = ({ shot, assets, entryDelay = 0, next }) => {
  const frame = useCurrentFrame();
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
            screen={shot.screen}
            delay={entryDelay}
            hold={entryDelay}
          />
          {shot.stat ? <StatNote stat={shot.stat} inset={framedSize(shot.footage ?? "", S.width, S.height)} /> : null}
        </Stage>
      );
      break;
    case "carousel":
      body = (
        <Carousel
          items={(shot.footages ?? []).map((id, i) => ({ id, title: shot.lines?.[i] ?? "", from: shot.froms?.[i] ?? shot.from }))}
          marks={markFrames(shot, assets)}
          duration={duration}
          assets={assets}
          note={shot.label}
        />
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
          {shot.cues?.length ? (
            <Stage>
              <Kinetic words={kineticWords(shot, assets)} marker={shot.marker} duration={duration} exit />
            </Stage>
          ) : (
            <TextCard lines={shot.lines ?? []} sub={shot.sub} beats={shot.beats} />
          )}
        </>
      );
      break;
    case "plate":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          {shot.cues?.length ? (
            <Stage>
              <Kinetic words={kineticWords(shot, assets)} marker={shot.marker} duration={duration} exit />
            </Stage>
          ) : null}
          <Plate lines={shot.lines ?? []} beats={shot.beats} />
        </>
      );
      break;
    case "ring": {
      // アプリの印を 72 時間の時計にする（parts/LogoClock.tsx）。声の「72 は」で時計へ、言葉の間に白い点が 0 → 72 時間を回る。
      // 次が重ねずに切り替える 3 本立てなら、最後に印がその見出しの印の所へ縮んで収まる
      const words = kineticWords(shot, assets);
      const markAt = markFrames(shot, assets)[0] ?? Math.round(duration * 0.3);
      const sweep: [number, number] = [words[0]?.frame ?? markAt + 24, Math.min(duration - 18, (words[words.length - 1]?.frame ?? markAt + 50) + 32)];
      body = (
        <LogoClock
          name={shot.lines?.[0] ?? "ケア72"}
          duration={duration}
          nameAt={shot.beats?.[0] !== undefined ? f(shot.beats[0]) - 3 : 12}
          markAt={markAt}
          sweep={sweep}
          to={next?.kind === "carousel" && next.cutIn ? carouselHead(next.lines ?? []).mark : undefined}
          plain={!words.length}
        >
          {words.length ? <Kinetic words={words} align="left" marker={shot.marker} /> : null}
        </LogoClock>
      );
      break;
    }
    case "number":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          {shot.survey ? (
            <Survey
              question={shot.survey.question}
              rows={shot.survey.rows}
              total={peopleTotal(shot.value)}
              whole={shot.sub ?? ""}
              land={shot.beats?.[0] !== undefined ? f(shot.beats[0]) : undefined}
              lead={slotWord(shot, assets, "lead")}
              marker={shot.marker}
            />
          ) : shot.value?.includes("→") ? (
            <Compare value={shot.value} labels={[shot.lines?.[0] ?? "", shot.lines?.[1] ?? ""]} sub={shot.sub} lead={slotWord(shot, assets, "lead")} marks={markFrames(shot, assets)} />
          ) : shot.value?.includes("人中") ? (
            <Share
              {...peopleShare(shot.value, shot.lines?.[0] ?? "", shot.sub ?? "")}
              extra={shot.lines?.[1]}
              land={shot.beats?.[0] !== undefined ? f(shot.beats[0]) : undefined}
              lead={slotWord(shot, assets, "lead")}
              tail={slotWord(shot, assets, "tail")}
              marker={shot.marker}
            />
          ) : shot.value?.endsWith("%") ? (
            <Share
              hero={shot.value}
              share={Number.parseFloat(shot.value) / 100}
              part={shot.lines?.[0] ?? ""}
              whole={shot.sub ?? ""}
              land={shot.beats?.[0] !== undefined ? f(shot.beats[0]) : undefined}
              lead={slotWord(shot, assets, "lead")}
              tail={slotWord(shot, assets, "tail")}
              marker={shot.marker}
            />
          ) : (
            <BigNumber value={shot.value ?? ""} sub={shot.sub} />
          )}
        </>
      );
      break;
    case "bars":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <Share hero="527 人" share={527 / 755} part="うち関連死" whole="死者 755 人" land={shot.beats?.[0] !== undefined ? f(shot.beats[0]) : undefined} />
        </>
      );
      break;
    case "memo":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <Memo mark={shot.beats?.[0] !== undefined ? f(shot.beats[0]) : undefined} />
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
          {shot.footages?.length ? (
            <Cycle ids={shot.footages} assets={assets} duration={duration} label={shot.label} />
          ) : shot.sub ? (
            // 端末の録画を外した形（11/6）: 右に作り方を字で
            <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 18 }}>
              {shot.sub.split("／").map((x, i) => (
                <div key={x} style={{ fontSize: i === 0 ? TYPE.h1 : TYPE.h2, fontWeight: 600, lineHeight: 1.2, ...rise(frame, 6 + i * STAGGER) }}>
                  {x}
                </div>
              ))}
            </div>
          ) : null}
        </Models>
      );
      break;
    case "quote":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <Quote text={shot.lines?.[0] ?? ""} sub={shot.sub} by={shot.by}>
            {shot.cues?.length ? <Kinetic words={kineticWords(shot, assets)} align="center" marker={shot.marker} duration={duration} exit /> : undefined}
          </Quote>
        </>
      );
      break;
    case "end":
      body = (
        <>
          <Backdrop shot={shot} assets={assets} duration={duration} />
          <EndCard repo={REPO} duration={duration} />
        </>
      );
      break;
  }
  const image = shot.bg && (assets.bg?.[shot.bg] ?? 0) > 0 ? "イメージ（AI 生成）" : shot.kind === "memo" ? "イメージ" : null;
  return (
    <AbsoluteFill>
      {body}
      {shot.kind === "footage" && shot.sub ? <Caption text={shot.sub} corner="bottomLeft" /> : null}
      {shot.source ? <Caption text={`出典 ${shot.source}`} corner={palette(sceneOf(shot.at).ground).bg === COLOR.blue ? "topLeft" : "bottomLeft"} /> : null}
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

/**
 * 絵 1 つ。前後の CROSS コマで薄くなる・濃くなる。
 * 地が替わる所（wipeIn・wipeOut）は薄くせず、地の幕の境目で切る（新しい段の絵は境目より下、前の段の絵は境目より上だけ）
 */
const Faded: React.FC<{ length: number; fadeIn: boolean; fadeOut: boolean; wipeIn?: boolean; wipeOut?: boolean; children: React.ReactNode }> = ({
  length,
  fadeIn,
  fadeOut,
  wipeIn = false,
  wipeOut = false,
  children,
}) => {
  const frame = useCurrentFrame();
  // 前の絵は重なりの頭の 6 コマで消え、次の絵は 2 コマ遅れて 8 コマで出る（2 つの絵が半分ずつ重なって二重に見える間を短く）
  const a = fadeIn && !wipeIn ? progress(frame, 2, CROSS - 2) : 1;
  const b = fadeOut && !wipeOut ? 1 - progress(frame, length - CROSS, 6) : 1;
  const clipPath = wipeIn && frame < WIPE ? wipeBelow(frame) : wipeOut && frame >= length - WIPE ? wipeAbove(frame - (length - WIPE)) : undefined;
  return <AbsoluteFill style={{ opacity: Math.min(a, b), clipPath }}>{children}</AbsoluteFill>;
};

/** 地の色。場面の頭で前の場面と地が違えば CROSS コマで混ぜる */
const GroundLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const i = Math.max(0, SCENES.findIndex((s) => frame < f(s.end)));
  const scene = SCENES[i] ?? SCENES[SCENES.length - 1];
  const prev = SCENES[i - 1];
  const now = palette(scene.ground).bg;
  if (!prev || prev.ground === scene.ground) return <AbsoluteFill style={{ background: now }} />;
  return (
    <AbsoluteFill style={{ background: palette(prev.ground).bg }}>
      <AbsoluteFill style={{ background: now, clipPath: wipeBelow(frame - f(scene.at)) }} />
    </AbsoluteFill>
  );
};

/**
 * 地の色が替わる所（青 → 白の S4、白 → 青の S8）の幕。新しい地が下から上へ差し込む（WIPE コマ、ease-in-out。
 * 境目は真っ直ぐで、ぼかさない・色を混ぜない）。新しい段の物（絵・見出しの帯・大きな名前）は境目より下だけ、
 * 前の段の物は境目より上だけ見せる（幕が前の段を覆い、次の段を連れて上がる）
 */
const WIPE = 16;
const wipeT = (local: number) => progress(local, 0, WIPE, EASE_IN_OUT);
const wipeBelow = (local: number) => `inset(${((1 - wipeT(local)) * 100).toFixed(2)}% 0 0 0)`;
const wipeAbove = (local: number) => `inset(0 0 ${(wipeT(local) * 100).toFixed(2)}% 0)`;

/** その段の頭で地が替わるか */
const groundChanges = (scene: Scene): boolean => {
  const i = SCENES.indexOf(scene);
  return i > 0 && SCENES[i - 1].ground !== scene.ground;
};

/**
 * 計画・訓練・発災時（S4〜S6）の頭: 段の名前が舞台の真ん中に大きく出て、上の帯の名前の所へ縮んで収まる。
 * 出る 10 コマ → 止まる 6 コマ → 縮んで動く 14 コマ（ease-in-out、行き過ぎない）。収まったら帯の名前に替わる。
 * 名前は前の絵が消えてから出る（地が替わる S4 は幕が名前の所を過ぎてから）。
 * その段の最初の録画は、名前が帯の近くまで縮んでから上がる（大きな名前と録画を重ねない）
 */
const FLY_SCENES = new Set(["S4", "S5", "S6"]);
// hold は線の絵が描き終わるのを見せる間（11/6 に絵を足して 6 → 18 コマ）
const FLY = { in: 10, hold: 18, fly: 14 };
const FLY_END = FLY.in + FLY.hold + FLY.fly;
const titleStart = (scene: Scene): number => (groundChanges(scene) ? 8 : 4);
const entryDelay = (scene: Scene): number => titleStart(scene) + FLY_END - 3;

const FlyTitle: React.FC<{ title: string; local: number; scene?: string }> = ({ title, local, scene }) => {
  const p = usePalette();
  const H = LAYOUT.header;
  const size = TYPE.display;
  const lineH = size * 1.2;
  // 字の幅は日本語の字 1 つで 1em（題名は漢字とかなだけ）
  const width = size * [...title].length;
  const S = LAYOUT.stage;
  const left0 = S.left + S.width / 2 - width / 2;
  const top0 = S.top + S.height / 2 - lineH / 2;
  const scale1 = 30 / size;
  const left1 = H.left;
  const top1 = H.top + (H.height - lineH * scale1) / 2;
  const enter = progress(local, 0, FLY.in);
  const move = progress(local, FLY.in + FLY.hold, FLY.fly, EASE_IN_OUT);
  const left = left0 + (left1 - left0) * move;
  const top = top0 + (top1 - top0) * move + (1 - enter) * 24;
  const scale = 1 + (scale1 - 1) * move;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        fontFamily: FONT.main,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        color: p.fg,
        opacity: enter,
        transformOrigin: "0 0",
        transform: `scale(${scale.toFixed(4)})`,
      }}
    >
      {title}
      {scene ? (
        <div style={{ position: "absolute", left: "50%", bottom: "100%", marginBottom: 28, transform: "translateX(-50%)", opacity: 1 - move }}>
          <SceneIcon scene={scene} local={local} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * 段の頭の線の絵（作者の頼み 11/6）。線を引いていくように描く（生成の絵は使わない）。
 * 計画 = 紙と項目が埋まる、訓練 = 時計の針が回る、発災時 = スマホに安否の波
 */
const SceneIcon: React.FC<{ scene: string; local: number }> = ({ scene, local }) => {
  const p = usePalette();
  const draw = (i: number) => progress(local, 2 + i * 4, 10);
  const len = 400;
  const line = (i: number): React.SVGProps<SVGPathElement> => ({ fill: "none", stroke: p.fg, strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: len, strokeDashoffset: len * (1 - draw(i)) });
  const size = 150;
  if (scene === "S4") {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <path d="M28 12 H62 L76 26 V88 H28 Z" {...line(0)} />
        <path d="M62 12 V26 H76" {...line(1)} />
        {[40, 54, 68].map((y, i) => (
          <g key={y}>
            <path d={`M36 ${y} l4 4 l7 -8`} {...line(2 + i)} />
            <path d={`M53 ${y} H68`} {...line(2 + i)} />
          </g>
        ))}
      </svg>
    );
  }
  if (scene === "S5") {
    const a = (progress(local, 8, 26) * 300 - 90) * (Math.PI / 180);
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="54" r="34" {...(line(0) as React.SVGProps<SVGCircleElement>)} />
        <path d="M42 12 H58 M50 12 V20" {...line(1)} />
        <path d={`M50 54 L${(50 + Math.cos(a) * 24).toFixed(2)} ${(54 + Math.sin(a) * 24).toFixed(2)}`} stroke={p.fg} strokeWidth={7} strokeLinecap="round" opacity={draw(1)} />
        <circle cx="50" cy="54" r="4" fill={p.fg} opacity={draw(1)} />
      </svg>
    );
  }
  const wave = (i: number) => progress(local, 12 + i * 5, 8);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d="M34 14 H58 Q62 14 62 18 V82 Q62 86 58 86 H34 Q30 86 30 82 V18 Q30 14 34 14 Z" {...line(0)} />
      <path d="M42 76 H50" {...line(1)} />
      {[0, 1].map((i) => (
        <path key={i} d={`M${70 + i * 9} ${38 - i * 6} Q${78 + i * 12} 50 ${70 + i * 9} ${62 + i * 6}`} fill="none" stroke={p.fg} strokeWidth={7} strokeLinecap="round" opacity={wave(i)} />
      ))}
    </svg>
  );
};

/** 道具の段（S4〜S7）の見出しの帯。段の名前と 72 時間の線 */
const TOOL_SCENES: Record<string, { title: string; state: string; hours: (t: number) => number | null }> = {
  S4: { title: "計画", state: "平時", hours: () => 0 },
  // 訓練の画面には訓練の経過の棒がある（絵は時刻の順でもない）ので、上の 72 時間の線は出さない（画面の「経過 3 時間」と食い違わせない）
  S5: { title: "訓練", state: "地震想定", hours: () => null },
  // 発災時の録画は切り替えて数分（画面は「発災 1 分」〜「9 分」）。線は 0 の近くに置く
  S6: { title: "発災時", state: "地震", hours: () => 0.15 },
  S7: { title: "使い分け", state: "Claude Code", hours: () => null },
};

const TOOLS = SCENES.filter((s) => TOOL_SCENES[s.id]);
/** 道具の段の次の段（S8）の頭で地が替わるなら、帯はその幕に覆われるまで残す */
const TOOLS_TAIL = (() => {
  const next = SCENES[SCENES.indexOf(TOOLS[TOOLS.length - 1]) + 1];
  return next && groundChanges(next) ? WIPE : 0;
})();

const ToolHeader: React.FC = () => {
  const frame = useCurrentFrame();
  const first = TOOLS[0];
  const lastTool = TOOLS[TOOLS.length - 1];
  const abs = frame + f(first.at);
  const tail = abs >= f(lastTool.end);
  const scene = tail ? lastTool : SCENES.find((s) => abs >= f(s.at) && abs < f(s.end));
  const info = scene ? TOOL_SCENES[scene.id] : undefined;
  if (!scene || !info) return null;
  const t = Math.min(1, (abs - f(scene.at)) / Math.max(1, f(scene.end) - f(scene.at)));
  const local = abs - f(scene.at);
  const start = titleStart(scene);
  const flying = FLY_SCENES.has(scene.id) && local < start + FLY_END;
  const clipPath = tail ? wipeAbove(abs - f(lastTool.end)) : groundChanges(scene) && local < WIPE ? wipeBelow(local) : undefined;
  return (
    <GroundProvider ground={scene.ground}>
      <AbsoluteFill style={{ clipPath }}>
        {/* 上の帯の 72 時間の線は外した（作者の声 11/6）。段の名前と状態だけ */}
        <Header title={info.title} state={info.state} hours={null} titleOpacity={flying ? 0 : 1} />
        {flying ? <FlyTitle title={info.title} local={local - start} scene={scene.id} /> : null}
      </AbsoluteFill>
    </GroundProvider>
  );
};

/** 音楽の大きさ。声のある所と強調の所で下げる（強調は一番下げる） */
/** 音楽の大きさ。声の出入りで段にならないよう、前後 6 コマ（0.4 秒）の平均でなめらかに変える */
function musicVolume(frame: number): number {
  let sum = 0;
  for (let d = -6; d <= 6; d++) sum += musicTarget(frame + d);
  return sum / 13;
}

function musicTarget(frame: number): number {
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
  // 段の最初の絵で、前の段と地が違う（幕で入れ替わる）
  const wipeIn = (k: number) => k > 0 && k < shots.length && shots[k].shot === shots[k].scene.shots[0] && groundChanges(shots[k].scene);
  // 重ねずに切り替える絵（前の絵の印が収まる続き）
  const cutIn = (k: number) => k > 0 && k < shots.length && shots[k].shot.cutIn === true;
  const toolFrom = f(TOOLS[0]?.at ?? 0);
  const toolTo = f(TOOLS[TOOLS.length - 1]?.end ?? 0);
  return (
    <AbsoluteFill style={{ background: COLOR.blue, fontFamily: FONT.main }}>
      <GroundLayer />
      {shots.map(({ scene, shot }, k) => {
        const length = f(shot.end) - f(shot.at);
        const last = k === shots.length - 1;
        // 次の段へ幕で替わる絵は、幕が覆い終わるまで残す
        const extended = length + (last ? 0 : wipeIn(k + 1) ? WIPE : cutIn(k + 1) ? 0 : CROSS);
        return (
          <Sequence key={`${shot.at}`} from={f(shot.at)} durationInFrames={extended} name={`${scene.id} ${shot.label}`}>
            <GroundProvider ground={scene.ground}>
              <Faded length={extended} fadeIn={k > 0 && !cutIn(k)} fadeOut={!last && !cutIn(k + 1)} wipeIn={wipeIn(k)} wipeOut={!last && wipeIn(k + 1)}>
                <ShotView
                  shot={shot}
                  assets={assets}
                  entryDelay={FLY_SCENES.has(scene.id) && shot === scene.shots[0] ? entryDelay(scene) : 0}
                  next={shots[k + 1]?.shot}
                />
              </Faded>
            </GroundProvider>
          </Sequence>
        );
      })}
      {toolTo > toolFrom ? (
        <Sequence from={toolFrom} durationInFrames={toolTo - toolFrom + TOOLS_TAIL} name="見出しの帯">
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
