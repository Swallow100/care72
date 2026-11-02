"use client";

// 紙面の印刷（ブラウザの印刷の画面。PDF にするのもここから）
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md bg-panel2 px-4 py-1.5 font-bold" data-press>
      印刷
    </button>
  );
}
