// 偽の画面（docs/tasks/T156.md）。Chrome と next dev を使わずに台の筋を通すための、ケア72 の小さな写し。
// 画面の言葉と並びは手元の本物の画面（11/6 の種）に合わせた最小限: ログイン・担当一覧・利用者追加・本人のページ（避難先の編集・
// 計画書の表示）・訓練（着信の窓・次まで・自動進行）・事業所（発災開始の窓・担当の変更・最初に戻す）・書類（印刷）・様式 9・
// 受入一覧（氏名検索・避難所・受入・追記）・本人スマホ（赤）・役変更。本物と違う所があっても台の筋を確かめる物で、本物の代わりではない。

import { hashOf, lookOf } from "./dom.ts";
import type { Secrets, Surface } from "./surface.ts";
import type { ActResult, Item, Move, Snapshot } from "./types.ts";

type State = {
  loggedIn: boolean;
  role: "cm" | "medical" | "self";
  disaster: boolean;
  roleMenu: boolean;
  startConfirm: boolean;
  resetConfirm: boolean;
  people: Array<{ id: string; name: string; place: string | null }>;
  editing: boolean;
  drill: { hours: number; ringing: boolean; auto: boolean } | null;
  assignOpen: boolean;
  assignTo: string | null;
  assigned: boolean;
  search: boolean;
  found: boolean;
  shelterOpen: boolean;
  shelter: string | null;
  received: boolean;
  noteOpen: boolean;
  note: string | null;
  red: boolean;
  values: Record<string, string>;
  alert: string | null;
};

type FakeItem = Omit<Item, "ref"> & { on?: (st: State) => string | void };
type FakePage = { title: string; headings: string[]; text: string; items: FakeItem[]; modal?: boolean };

const fresh = (): State => ({
  loggedIn: false,
  role: "cm",
  disaster: false,
  roleMenu: false,
  startConfirm: false,
  resetConfirm: false,
  people: [
    { id: "chk-p-01", name: "山田 ハナ", place: "かわなぎ小学校" },
    { id: "chk-p-05", name: "伊藤 フミ", place: null },
  ],
  editing: false,
  drill: null,
  assignOpen: false,
  assignTo: null,
  assigned: false,
  search: false,
  found: false,
  shelterOpen: false,
  shelter: null,
  received: false,
  noteOpen: false,
  note: null,
  red: false,
  values: {},
  alert: null,
});

export type FakeSiteOptions = { loginId: string; password: string };

export class FakeSurface implements Surface {
  private st: State = fresh();
  private path = "/";
  private history: string[] = [];
  private refs = new Map<number, FakeItem>();
  private readonly opts: FakeSiteOptions;
  /** 開いた道（テストで見る） */
  readonly visited: string[] = [];

  constructor(opts: FakeSiteOptions) {
    this.opts = opts;
  }

  private header(): string {
    if (!this.st.loggedIn) return "ケア72";
    const mode = this.st.disaster ? "大雨" : "平時";
    if (this.st.role === "medical") return "ケア72 受入一覧 医療班 山本 役変更 ログアウト";
    return `ケア72 担当一覧 訓練 事業所 書類 ${mode} デモ事業所（確認用） 管理者 山本 役変更 ログアウト`;
  }

  private nav(): FakeItem[] {
    const st = this.st;
    if (!st.loggedIn) return [];
    const cm: FakeItem[] =
      st.role === "cm"
        ? [
            { role: "link", name: "担当一覧", zone: "切替:画面", on: () => "/" },
            { role: "link", name: "訓練", zone: "切替:画面", on: () => "/drill" },
            { role: "link", name: "事業所", zone: "切替:画面", on: () => "/office" },
            { role: "link", name: "書類", zone: "切替:画面", on: () => "/forms" },
          ]
        : [];
    const menu: FakeItem[] = st.roleMenu
      ? [
          { role: "button", name: "ケアマネ 担当一覧", zone: "上", on: (s) => ((s.role = "cm"), (s.roleMenu = false), "/") },
          { role: "button", name: "医療班 受入一覧", zone: "上", on: (s) => ((s.role = "medical"), (s.roleMenu = false), "/staff") },
          { role: "button", name: "本人スマホ 山田 ハナ", zone: "上", on: (s) => ((s.role = "self"), (s.roleMenu = false), "/me") },
        ]
      : [];
    return [...cm, { role: "button", name: "役変更", zone: "上", on: (s) => void (s.roleMenu = !s.roleMenu) }, ...menu, { role: "button", name: "ログアウト", zone: "上", on: (s) => ((s.loggedIn = false), "/login") }];
  }

  private value(name: string): string {
    return this.st.values[`${this.path.split("?")[0]}|${name}`] ?? "";
  }

  private page(): FakePage {
    const st = this.st;
    const p = this.path.split("?")[0];
    const box = (name: string): FakeItem => ({ role: "textbox", name, value: this.value(name) || undefined });
    if (!st.loggedIn || p === "/login") {
      return {
        title: "ログイン | ケア72",
        headings: ["ログイン"],
        text: "ログイン ID パスワード ログイン",
        items: [
          box("ID"),
          { role: "password", name: "パスワード" },
          {
            role: "button",
            name: "ログイン",
            on: (s) => {
              const ok = this.value("ID") === this.opts.loginId && this.value("パスワード") === this.opts.password;
              if (!ok) {
                s.alert = "ID かパスワードが違う";
                return "/login?e=1";
              }
              s.loggedIn = true;
              return "/";
            },
          },
        ],
      };
    }
    if (p === "/") {
      return {
        title: "ケア72",
        headings: ["担当一覧", "避難計画"],
        text: `担当一覧 ${st.people.length} 人 ${st.disaster ? "至急 1 山田 ハナ" : "作成済 下書き"}`,
        items: [
          { role: "link", name: "利用者追加", on: () => "/people/new" },
          { role: "link", name: "一括印刷", on: () => "/caseload/own-sheets?print=1" },
          ...st.people.map((x): FakeItem => ({ role: "link", name: x.name, on: () => `/people/${x.id}` })),
        ],
      };
    }
    if (p === "/people/new") {
      return {
        title: "ケア72",
        headings: ["利用者追加"],
        text: "利用者追加 氏名 カナ 生年月日 性別 作成",
        items: [
          { role: "link", name: "戻る", on: () => "/" },
          box("氏名"),
          box("カナ"),
          box("生年月日"),
          { role: "radio", name: "女", checked: this.st.values["/people/new|性別"] === "女", on: (s) => void (s.values["/people/new|性別"] = "女") },
          { role: "radio", name: "男", checked: this.st.values["/people/new|性別"] === "男", on: (s) => void (s.values["/people/new|性別"] = "男") },
          {
            role: "button",
            name: "作成",
            on: (s) => {
              const name = this.value("氏名");
              if (!name) {
                s.alert = "氏名 未入力";
                return;
              }
              const id = `chk-p-${String(s.people.length + 10).padStart(2, "0")}`;
              s.people.push({ id, name, place: null });
              return `/people/${id}`;
            },
          },
        ],
      };
    }
    const person = /^\/people\/([^/]+)(\/.*)?$/.exec(p);
    if (person) {
      const who = st.people.find((x) => x.id === person[1]);
      if (!who) return { title: "ケア72", headings: ["見つからない"], text: "見つからない", items: [{ role: "link", name: "戻る", on: () => "/" }] };
      if (person[2]?.startsWith("/forms/")) {
        return { title: "ケア72", headings: [`${who.name} 計画書`], text: `計画書 ${who.name}`, items: [{ role: "link", name: "戻る", on: () => `/people/${who.id}` }, { role: "button", name: "印刷", on: () => `${p}?print=1` }] };
      }
      const medical = st.role === "medical";
      return {
        title: "ケア72",
        headings: medical ? [who.name, "要約", "経過"] : [who.name, "医療", "避難", "書類", "経過"],
        text: `${who.name} 避難先 ${who.place ?? "未入力"}${st.note ? ` 経過 ${st.note}` : ""}`,
        items: [
          { role: "link", name: "戻る", on: () => (medical ? "/staff" : "/") },
          ...(medical
            ? []
            : [
                { role: "button", name: "編集", on: () => undefined } satisfies FakeItem,
                { role: "button", name: "編集", on: (s: State) => void (s.editing = true) } satisfies FakeItem,
              ]),
          ...(st.editing ? [box("避難先1"), { role: "button", name: "保存", on: (s: State) => void ((who.place = this.value("避難先1") || who.place), (s.editing = false)) } satisfies FakeItem] : []),
          ...(medical
            ? []
            : [
                // スマホ入口の「表示」は計画共有に同意のある種の人だけ（足したばかりの人には無い）
                // 書類の行の「表示」「印刷」は書類の名前つき（本物の components/person/DocumentSection。T162）
                ...(who.id.startsWith("chk-p-0") ? [{ role: "link", name: "スマホ入口 表示", on: () => `/people/${who.id}/phone` } satisfies FakeItem] : []),
                { role: "link", name: "計画書 表示", on: () => `/people/${who.id}/forms/matsuyama` } satisfies FakeItem,
                { role: "link", name: "計画書 印刷", on: () => `/people/${who.id}/forms/matsuyama?print=1` } satisfies FakeItem,
              ]),
          // 経過の書き足し: 自由文に書くと「追記」が押せる（本物の本人のページと同じ）
          box("自由文"),
          { role: "button", name: "追記", disabled: !this.value("自由文"), on: (s) => void ((s.note = this.value("自由文")), (s.values[`${this.path.split("?")[0]}|自由文`] = "")) },
        ],
      };
    }
    if (p === "/drill") {
      return {
        title: "訓練記録 | ケア72",
        headings: ["訓練記録", "開始"],
        text: "訓練記録 開始 大雨想定 地震想定 仮想",
        items: [
          { role: "button", name: "設定" },
          { role: "button", name: "大雨想定", on: (s) => ((s.drill = { hours: 0, ringing: true, auto: false }), "/drill/d-1") },
          { role: "button", name: "地震想定" },
        ],
      };
    }
    if (p === "/drill/d-1" && st.drill) {
      const d = st.drill;
      if (d.ringing) {
        return {
          title: "訓練 | ケア72",
          headings: ["訓練 大雨想定", `経過 ${d.hours} 時間`],
          text: `経過 ${d.hours} 時間 着信 家族`,
          modal: true,
          items: [
            { role: "button", name: "出ない", zone: "窓", on: (s) => void (s.drill!.ringing = false) },
            { role: "button", name: "出る", zone: "窓", on: (s) => void (s.drill!.ringing = false) },
          ],
        };
      }
      return {
        title: "訓練 | ケア72",
        headings: ["訓練 大雨想定", `経過 ${d.hours} 時間`],
        text: `経過 ${d.hours} 時間`,
        items: [
          { role: "link", name: "戻る", on: () => "/drill" },
          {
            role: "button",
            name: "次まで",
            on: (s) => {
              s.drill!.hours += 3;
              s.drill!.ringing = s.drill!.hours === 3;
            },
          },
          { role: "checkbox", name: "自動進行", checked: d.auto, on: (s) => void ((s.drill!.auto = !s.drill!.auto), (s.drill!.hours += 6)) },
        ],
      };
    }
    if (p === "/office") {
      const win: FakeItem[] = st.startConfirm
        ? [
            { role: "button", name: "取消", zone: "窓:発災開始", on: (s) => void (s.startConfirm = false) },
            { role: "button", name: "開始", zone: "窓:発災開始", on: (s) => void ((s.startConfirm = false), (s.disaster = true)) },
          ]
        : [];
      return {
        title: "ケア72",
        headings: ["事業所", "災害モード", "担当", "初期化"],
        text: `事業所 ${st.disaster ? "大雨" : "平時"} 担当 山本 ${st.assigned ? 1 : 2} 西村 ${st.assigned ? 1 : 0}${this.path.includes("reset=done") ? " 最初に戻した" : ""}`,
        items: [
          ...win,
          ...(st.resetConfirm
            ? [
                {
                  role: "button",
                  name: "最初に戻す",
                  zone: "窓:初期化",
                  on: (s: State) => {
                    const keep = { loggedIn: s.loggedIn, role: s.role };
                    Object.assign(s, fresh(), keep);
                    return "/office?reset=done";
                  },
                } satisfies FakeItem,
              ]
            : []),
          { role: "button", name: "最初に戻す", on: (s) => void (s.resetConfirm = true) },
          { role: "button", name: "発災開始", on: (s) => void (s.startConfirm = true) },
          { role: "combobox", name: "伊藤 フミ 担当", value: st.assignTo ?? "山本", on: (s) => void (s.assignOpen = true) },
          ...(st.assignOpen ? [{ role: "option", name: "西村", zone: "一覧:伊藤 フミ 担当", checked: st.assignTo === "西村", on: (s: State) => void ((s.assignTo = "西村"), (s.assignOpen = false)) } satisfies FakeItem] : []),
          // 担当を選ぶまで押せない（本物の components/office/AssignForm。T162）
          { role: "button", name: "伊藤 フミ 担当変更", disabled: !st.assignTo, on: (s) => void (s.assignTo ? (s.assigned = true) : undefined) },
        ],
      };
    }
    if (p === "/forms") {
      return {
        title: "書類",
        headings: ["書類", "計画書"],
        text: "書類 計画書 本人ごと 事業所",
        items: [
          { role: "link", name: "書類", zone: "切替:書類", on: () => "/forms" },
          { role: "link", name: "様式9", zone: "切替:書類", on: () => "/office/form9" },
          // 行の「印刷」は氏名と書類の名前つき（本物の components/forms/DocumentList。T162）
          ...st.people.map((x): FakeItem => ({ role: "link", name: `${x.name} 計画書（松山市） 印刷`, on: () => `/people/${x.id}/forms/matsuyama?print=1` })),
        ],
      };
    }
    if (p === "/office/form9") {
      return { title: "様式9", headings: ["様式9"], text: "様式9 災害時利用者一覧表", items: [{ role: "link", name: "書類", on: () => "/forms" }, { role: "button", name: "印刷", on: () => "/office/form9?print=1" }] };
    }
    if (p === "/staff") {
      return {
        title: "受入一覧 | ケア72",
        headings: ["受入一覧", "受入"],
        text: `受入一覧 ${st.received ? 1 : 0} 人 避難所 ${st.shelter ?? "未入力"}`,
        items: [
          box("避難所"),
          { role: "button", name: "氏名検索", on: (s) => void (s.search = true) },
          { role: "button", name: "新規登録" },
          ...(st.search ? [box("氏名・カナ"), { role: "button", name: "検索", on: (s: State) => void (s.found = this.value("氏名・カナ").length > 0) } satisfies FakeItem] : []),
          ...(st.found
            ? [
                {
                  role: "button",
                  name: "受入",
                  on: (s: State) => {
                    s.shelter = this.value("避難所") || null;
                    if (!s.shelter) s.alert = "避難所 未入力";
                    else s.received = true;
                  },
                } satisfies FakeItem,
              ]
            : []),
          ...(st.received ? [{ role: "link", name: "山田 ハナ", on: () => "/people/chk-p-01" } satisfies FakeItem] : []),
        ],
      };
    }
    if (p === "/me") {
      return {
        title: "ケア72",
        headings: ["山田 ハナさん"],
        text: st.red ? "AI が聞いています 命が危ないと感じたら、すぐ119番へ" : "大丈夫ですか",
        items: [
          { role: "button", name: "無事", on: () => undefined },
          { role: "button", name: "無事じゃない", on: (s) => void (s.red = true) },
        ],
      };
    }
    return { title: "ケア72", headings: ["見つからない"], text: "404", items: [{ role: "link", name: "担当一覧", on: () => "/" }] };
  }

  async open(path: string): Promise<void> {
    this.history.push(this.path);
    this.path = path;
    this.visited.push(path);
  }

  async snapshot(): Promise<Snapshot> {
    // 入ったあとのログインの画面は担当一覧へ（本物の /login と同じ）
    if (this.st.loggedIn && this.path.startsWith("/login")) this.path = "/";
    const pg = this.page();
    const all = pg.modal ? pg.items : [...this.nav(), ...pg.items];
    this.refs.clear();
    const items: Item[] = all.map((it, i) => {
      this.refs.set(i + 1, it);
      const { on: _on, ...rest } = it;
      return { ref: i + 1, ...rest };
    });
    const alerts = this.st.alert ? [this.st.alert] : [];
    this.st.alert = null;
    const snap = { url: `http://localhost${this.path}`, path: this.path, title: pg.title, headings: pg.headings, items, alerts, header: this.header(), text: pg.text, body: pg.text, printed: /[?&]print=1/.test(this.path), errors: [] as string[] };
    return { ...snap, hash: hashOf(snap), look: lookOf(snap) };
  }

  async act(move: Move, secrets: Secrets): Promise<ActResult> {
    if (move.action === "back") {
      const prev = this.history.pop();
      if (prev) this.path = prev;
      return { ok: true };
    }
    if (move.action === "done" || move.action === "give_up") return { ok: true };
    const it = move.ref !== null ? this.refs.get(move.ref) : undefined;
    if (!it) return { ok: false, error: `番号 ${move.ref} の物が無い` };
    if (move.action === "type" || move.action === "select") {
      const text = (move.text ?? "").split("{{password}}").join(secrets.password);
      this.st.values[`${this.path.split("?")[0]}|${it.name}`] = text;
      return { ok: true };
    }
    const next = it.on?.(this.st);
    if (typeof next === "string" && next !== this.path) {
      this.history.push(this.path);
      this.path = next;
      this.visited.push(next);
    }
    return { ok: true };
  }

  async shot(): Promise<boolean> {
    return false;
  }

  async login(id: string, secrets: Secrets): Promise<boolean> {
    if (id !== this.opts.loginId || secrets.password !== this.opts.password) return false;
    this.st.loggedIn = true;
    this.path = "/";
    return true;
  }

  async end(): Promise<void> {
    this.st = fresh();
    this.path = "/";
    this.history = [];
  }
}
