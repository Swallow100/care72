// 年齢と日付。日付は日本の暦（JST）で数える。

/** いまの日付（JST）を YYYY-MM-DD で */
export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** birth（YYYY-MM-DD）の人が on（YYYY-MM-DD）に何歳か */
export function ageOn(birth: string, on: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [oy, om, od] = on.split("-").map(Number);
  if ([by, bm, bd, oy, om, od].some((n) => !Number.isInteger(n))) {
    throw new Error(`日付の形が違う: ${birth} / ${on}`);
  }
  const hadBirthday = om > bm || (om === bm && od >= bd);
  return oy - by - (hadBirthday ? 0 : 1);
}
