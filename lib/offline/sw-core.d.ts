// lib/offline/sw-core.js の型（tsconfig は allowJs: false なので、テストから読むための型だけをここに書く）

export const CACHE_PREFIX: string;
export const CACHE_VERSION: string;
export const PAGE_CACHE: string;
export const ASSET_CACHE: string;
export const AT_HEADER: string;
export const URL_HEADER: string;
export const CACHED_AT_META: string;
export const KEEP_MESSAGE: string;
export const MAX_PAGES: number;
export const MAX_ASSETS: number;
export const MAX_KEEP_ASSETS: number;
export const KEEP_MIN_MS: number;
export const NETWORK_WAIT_MS: number;
export const CLEAR_PATHS: readonly string[];

export type ResponseLike = { status: number; type: string; redirected: boolean; headers: { get(name: string): string | null } };
export type CopyPick = { kind: "serve"; key: string } | { kind: "redirect"; key: string; to: string };

export function copyKey(url: URL): string | null;
export function copyCandidates(url: URL): string[];
export function isPageRequest(method: string, mode: string, url: URL, origin: string): boolean;
export function isAssetRequest(method: string, url: URL, origin: string): boolean;
export function isPhoneLinkPath(pathname: string): boolean;
export function clearsCopies(method: string, url: URL, origin: string): boolean;
export function isPhoneLinkOpen(method: string, mode: string, url: URL, origin: string): boolean;
export function storable(res: ResponseLike | null | undefined): boolean;
export function fellThrough(res: { status: number } | null | undefined): boolean;
export function pickCopy(url: URL, stored: Record<string, string | undefined>): CopyPick | null;
export function markCopy(html: string, at: string): string;
export function assetUrls(html: string): string[];
export function cssAssetUrls(css: string, cssHref: string, origin: string): string[];
export function freshCopy(at: string | null | undefined, nowMs: number, minMs: number): boolean;
