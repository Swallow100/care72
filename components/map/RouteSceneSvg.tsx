// 避難経路の地図の絵（T102）。lib/map/route-image.ts の routeScene を画面に描く（紙は同じ中身を sceneSvg の文字列で描く）。
// 本人のページの避難の面の小さな絵と、経路地図の窓の地図で使う。担当一覧の地図（CaseMap）の雨と状態の層とは別の部品。
// - 下の地図は地理院タイル（淡色地図）。ライトは少し薄く、ダークは明るさを落とす（位置を置く小さな地図 LocationPick と同じ）
// - 線と印は操作の色 1 色（状態の 4 色は使わない）。線の下に面の色の縁。印の名前は「家」「避難先1」だけ（名前・住所の文字は無い）
// - 家は家の形、避難先は旗の形（T112。lib/map/route-image.ts の markPath を紙と同じく使う）
// - 出典は枠の中の下（紙と同じ）

import type { RouteScene, ScenePoint } from "@/lib/map/route-image";
import { dotGap, markPath, markTop, noteBox, ROUTE_MARKS, ROUTE_STYLE, type MarkShape } from "@/lib/map/route-image";
import { BASE_OPACITY } from "@/lib/map/layers";

const S = ROUTE_STYLE.px;

/**
 * px は画面に描いた幅（測れたとき）。渡すと線・印・字を画面の px で同じ大きさに保つ（小さな絵でも字が潰れない）。
 * 渡さなければ絵の中身の大きさ（routeScene の size）のまま
 */
export function RouteSceneSvg({ scene, label, px }: { scene: RouteScene; label: string; px?: number | null }) {
  const k = px && px > 0 ? scene.w / px : scene.scale;
  const pts = scene.line.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${scene.w} ${scene.h}`}
      className="block h-auto w-full select-none"
      role="img"
      aria-label={label}
      data-route-map=""
      style={{ ["--map-base-opacity" as string]: BASE_OPACITY }}
    >
      <rect width={scene.w} height={scene.h} className="fill-panel2" />
      {scene.tiles.map((t) => (
        <image
          key={t.href}
          href={t.href}
          x={t.x}
          y={t.y}
          width={t.size}
          height={t.size}
          preserveAspectRatio="none"
          className="opacity-(--map-base-opacity) dark:opacity-100 dark:brightness-[.82]"
        />
      ))}
      {scene.line.length >= 2 && (
        <>
          <polyline points={pts} fill="none" className="stroke-panel" strokeWidth={(S.line + S.halo * 2) * k} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pts} fill="none" className="stroke-accent-fill" strokeWidth={S.line * k} strokeLinejoin="round" strokeLinecap="round" data-route-line="" />
        </>
      )}
      {/* 本当の家 → 線の始まり（丸めた家の点から引いた線なので点線） */}
      {scene.dotted.length >= 2 && (
        <>
          <polyline
            points={scene.dotted.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            className="stroke-panel"
            strokeWidth={(S.line + S.halo * 2) * k}
            strokeDasharray={`0 ${dotGap(S) * k}`}
            strokeLinecap="round"
          />
          <polyline
            points={scene.dotted.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            className="stroke-accent-fill"
            strokeWidth={S.line * k}
            strokeDasharray={`0 ${dotGap(S) * k}`}
            strokeLinecap="round"
            data-route-dotted=""
          />
        </>
      )}
      {scene.via.map((v, i) => (
        <circle key={i} cx={v.x} cy={v.y} r={S.via * k} className="fill-panel stroke-accent-fill" strokeWidth={S.halo * k} data-route-via="" />
      ))}
      {scene.home && <Pin p={scene.home} label={ROUTE_MARKS.home} shape="home" k={k} />}
      {scene.dest && <Pin p={scene.dest} label={scene.destLabel} shape="dest" k={k} />}
      {scene.note && <Note note={scene.note} k={k} />}
      <Credits scene={scene} k={k} />
    </svg>
  );
}

function Pin({ p, label, shape, k }: { p: ScenePoint; label: string; shape: MarkShape; k: number }) {
  const r = S.pin * k;
  const ring = S.halo * k;
  return (
    <g data-route-pin={shape}>
      <path d={markPath(shape, p.x, p.y, r)} className="fill-accent-fill stroke-panel" strokeWidth={ring} strokeLinejoin="round" />
      <text
        x={p.x}
        y={p.y - r * markTop(shape) - ring * 2}
        textAnchor="middle"
        fontSize={S.font * k}
        fontWeight={700}
        className="fill-ink stroke-panel"
        strokeWidth={S.halo * 1.6 * k}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {label}
      </text>
    </g>
  );
}

/** 枠の左上の「経路 目安」 */
function Note({ note, k }: { note: string; k: number }) {
  const b = noteBox(note, S);
  return (
    <g data-route-note="">
      <rect x={0} y={0} width={b.w * k} height={b.h * k} className="fill-panel" fillOpacity={0.85} />
      <text x={b.pad * k} y={(b.pad / 2 + b.fs * 1.1) * k} fontSize={b.fs * k} fontWeight={700} className="fill-ink">
        {note}
      </text>
    </g>
  );
}

function Credits({ scene, k }: { scene: RouteScene; k: number }) {
  const fs = S.credit * k;
  const pad = S.pad * k;
  const lineH = fs * 1.3;
  const height = lineH * scene.credits.length + pad;
  const y0 = scene.h - height;
  return (
    <g data-route-credit="" fontSize={fs}>
      <rect x={0} y={y0} width={scene.w} height={height} className="fill-panel" fillOpacity={0.85} />
      {scene.credits.map((t, i) => (
        <text key={t} x={pad} y={y0 + pad / 2 + lineH * (i + 1) - (lineH - fs) / 2 - fs * 0.15} className="fill-ink">
          {t}
        </text>
      ))}
    </g>
  );
}
