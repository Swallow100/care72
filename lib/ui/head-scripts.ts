// app/layout.tsx の先頭に置く小さな script（T44）。部品が描かれる前、読み込みのいちばん早いうちに動かしたい物だけ。
// 中身は文字のまま <script> に入れるので、ここでは ES5 の書き方で、外の物を import しない。名前は lib/ui/install.ts と揃える。

/**
 * 押したときの灰色（globals.css の [data-pressing]）。:active だけだと、iPhone では指を置いた瞬間に出ず、
 * 短く叩くと離した後に一瞬しか出ない。ここでは pointerdown で data-pressing="on" を付け、離しても 120ms は残し、
 * "out" にして灰色をふわっと消す（360ms 後に印を外す）。スクロールが始まったら（pointercancel・scroll）すぐ消す。
 * - 押せない物（disabled・aria-disabled）と、data-no-press の中は付けない（連打する面など）
 * - data-press-host="<選択子>" を持つ物は、その祖先（行全体など）に付ける（行の一部だけがボタンのとき）
 * 色を付けるのは CSS の [data-press] の物だけ（data-press の無いボタンに印が付いても見た目は変わらない）。
 */
export const PRESS_SCRIPT = String.raw`(function(){var P='button,a[href],[role="button"],[role="tab"],[role="option"],summary,label,[data-press]',S=':disabled,[aria-disabled="true"]',c=null,t=0;function clr(e){if(e&&e.dataset&&e.dataset.pressing)delete e.dataset.pressing;}function cancel(){if(c)clr(c);c=null;}var o={capture:true,passive:true};document.addEventListener("pointerdown",function(v){if(v.button!==0||!v.target||!v.target.closest)return;var e;try{e=v.target.closest(P);}catch(x){return;}if(!e||!e.dataset||e.matches(S)||e.closest("[data-no-press]"))return;var hs=e.getAttribute("data-press-host"),h=null;try{h=hs&&e.closest(hs);}catch(x){}if(h)e=h;if(c&&c!==e)clr(c);c=e;t=Date.now();e.dataset.pressing="on";},o);document.addEventListener("pointerup",function(){var e=c;if(!e)return;c=null;setTimeout(function(){if(e.dataset.pressing!=="on")return;e.dataset.pressing="out";setTimeout(function(){if(e.dataset.pressing==="out")clr(e);},360);},Math.max(0,120-(Date.now()-t)));},o);document.addEventListener("pointercancel",cancel,o);document.addEventListener("scroll",cancel,o);window.addEventListener("blur",cancel);})();`;

/**
 * ホーム画面に追加（Android の Chrome などの 1 押しで入る画面）。beforeinstallprompt は読み込みの早いうちに 1 回だけ来るので、
 * 部品が描かれる前にここで受けて window.__care72Install に取っておき、care72-install-ready を投げる（components/phone/InstallHint.tsx が聞く）。
 * 入ったら（appinstalled）__care72Installed を立てる。LINE の外のブラウザで開き直したときは、付けた openExternalBrowser をアドレスから外す。
 */
export const INSTALL_SCRIPT = String.raw`(function(){var w=window;try{if(!/\bLine\//i.test(navigator.userAgent)){var u=new URL(location.href);if(u.searchParams.has("openExternalBrowser")){u.searchParams.delete("openExternalBrowser");history.replaceState(history.state,"",u.pathname+u.search+u.hash);}}}catch(x){}w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();w.__care72Install=e;w.dispatchEvent(new Event("care72-install-ready"));});w.addEventListener("appinstalled",function(){w.__care72Install=null;w.__care72Installed=1;w.dispatchEvent(new Event("care72-install-ready"));});})();`;
