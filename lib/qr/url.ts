// QR に入れる URL。開いている画面と同じ所（手元は http://localhost:port、配信は https）の /q/<token>。

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** 要求の見出しから元（scheme://host）。転送の見出しがあればそれを使う。host が無ければ null */
export function originFromHeaders(h: { get(name: string): string | null }): string | null {
  const host = (h.get("x-forwarded-host") ?? h.get("host"))?.split(",")[0].trim();
  if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return null;
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0].trim();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : LOCAL_HOST.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

export function qrUrl(origin: string, token: string): string {
  return `${origin}/q/${token}`;
}
