// 画面の部品が描かれる前に <head> で動かす小さな script（T51 で書き直した）。app/layout.tsx が文字のまま入れる。
// ES5 で書き、import しない（Next の束ねに入らず、hydration を待たずに動く）。名前は lib/ui/install.ts から差し込む。
//
// PRESS_SCRIPT: 押したときの灰色。iPhone の :active は指を置いた瞬間に出ず、短く叩くと離したあと一瞬しか出ないので補う。
//   押す物に data-pressing="on"（置いた瞬間）→ "out"（離して、置いてから 120ms 以上たってから）→ 外す（その 360ms 後）。
//   色は app/globals.css の [data-press][data-pressing] が持つ（ここは印を付けるだけ）。押した回（click）は邪魔しない。
//   スクロールが始まる・指が 8px 以上動く・pointercancel・窓の blur ですぐ消す（送り始めに灰色を残さない）。
// INSTALL_SCRIPT: ホーム画面に追加の 1 押しの画面（beforeinstallprompt）を受けて取っておく。入れたら印。LINE の外で開き直したら
//   アドレスの openExternalBrowser を外す。

import { EXTERNAL_BROWSER_PARAM, INSTALL_PROMPT_KEY, INSTALL_READY_EVENT, INSTALLED_KEY } from "./install";

/** 印を付ける物（data-press を持たない物も、ブラウザの既定の押す物は拾う。色が付くのは data-press の物だけ） */
export const PRESS_TARGETS = "button,a[href],[role=button],[role=tab],[role=option],summary,label,[data-press]";
/** 離してから消え始めるまでの、置いてからの最短の時間 */
export const PRESS_MIN_MS = 120;
/** "out" にしてから印を外すまで（globals.css の 0.32 秒の戻りより少し長く） */
export const PRESS_FADE_MS = 360;
/** 指がこれだけ動いたら押すのでなく送ると見て消す */
export const PRESS_MOVE_PX = 8;

export const PRESS_SCRIPT = `(function (w, d) {
  if (!w.addEventListener || !d.documentElement) return;
  var TARGETS = ${JSON.stringify(PRESS_TARGETS)};
  var MIN = ${PRESS_MIN_MS}, FADE = ${PRESS_FADE_MS}, MOVE = ${PRESS_MOVE_PX};
  var held = null, pointer = null, downAt = 0, x0 = 0, y0 = 0, timer = 0;

  function pick(node) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    if (!el || !el.closest) return null;
    try {
      if (el.closest("[data-no-press]")) return null;
      var hit = el.closest(TARGETS);
      if (!hit || hit.disabled || hit.getAttribute("aria-disabled") === "true") return null;
      var host = hit.getAttribute("data-press-host");
      if (host) {
        try {
          var up = hit.closest(host);
          if (up) hit = up;
        } catch (e) {}
      }
      return hit;
    } catch (e) {
      return null;
    }
  }

  function stopTimer() {
    if (timer) {
      w.clearTimeout(timer);
      timer = 0;
    }
  }

  function drop() {
    stopTimer();
    if (held) held.removeAttribute("data-pressing");
    held = null;
    pointer = null;
  }

  function letGo() {
    if (!held) return;
    var el = held;
    pointer = null;
    stopTimer();
    var wait = MIN - (Date.now() - downAt);
    timer = w.setTimeout(function () {
      if (held !== el) return;
      el.setAttribute("data-pressing", "out");
      timer = w.setTimeout(function () {
        timer = 0;
        if (held !== el) return;
        el.removeAttribute("data-pressing");
        held = null;
      }, FADE);
    }, wait > 0 ? wait : 0);
  }

  w.addEventListener("pointerdown", function (e) {
    drop();
    if (e.button !== 0 || e.isPrimary === false) return;
    var el = pick(e.target);
    if (!el) return;
    held = el;
    pointer = e.pointerId;
    downAt = Date.now();
    x0 = e.clientX;
    y0 = e.clientY;
    el.setAttribute("data-pressing", "on");
  }, { capture: true, passive: true });

  w.addEventListener("pointermove", function (e) {
    if (!held || pointer === null || e.pointerId !== pointer) return;
    var dx = e.clientX - x0, dy = e.clientY - y0;
    if (dx * dx + dy * dy >= MOVE * MOVE) drop();
  }, { capture: true, passive: true });

  w.addEventListener("pointerup", function (e) {
    if (pointer !== null && e.pointerId === pointer) letGo();
  }, { capture: true, passive: true });

  w.addEventListener("pointercancel", drop, { capture: true, passive: true });
  w.addEventListener("scroll", drop, { capture: true, passive: true });
  w.addEventListener("blur", drop);
})(window, document);`;

export const INSTALL_SCRIPT = `(function (w) {
  if (!w.addEventListener) return;
  var KEY = ${JSON.stringify(INSTALL_PROMPT_KEY)}, DONE = ${JSON.stringify(INSTALLED_KEY)}, READY = ${JSON.stringify(INSTALL_READY_EVENT)};
  var PARAM = ${JSON.stringify(EXTERNAL_BROWSER_PARAM)};

  function tell() {
    try {
      w.dispatchEvent(new Event(READY));
    } catch (e) {}
  }

  w.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    w[KEY] = e;
    tell();
  });

  w.addEventListener("appinstalled", function () {
    w[KEY] = null;
    w[DONE] = true;
    tell();
  });

  try {
    if (!/\\bLine\\/\\d/i.test(navigator.userAgent) && w.URL && w.history && w.history.replaceState) {
      var u = new URL(w.location.href);
      if (u.searchParams.has(PARAM)) {
        u.searchParams["delete"](PARAM);
        w.history.replaceState(w.history.state, "", u.pathname + u.search + u.hash);
      }
    }
  } catch (e) {}
})(window);`;
