/** Port of app.js generateChoices — must dedup with Set like legacy. */

export type ChoiceSource = {
  answer: string;
  wrong?: string[] | null;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export function generateChoices(task: ChoiceSource): string[] | null {
  const ans = String(task.answer ?? "").trim();
  if (!ans || ans.split("\n").length > 2) return null;

  /* Авторские ловушки из коллекции — приоритетнее автогенерации */
  const authored = [
    ...new Set(
      Array.isArray(task.wrong)
        ? task.wrong.map((w) => String(w).trim()).filter((w) => w && w !== ans)
        : [],
    ),
  ];
  if (authored.length >= 2) {
    return shuffle([ans, ...authored.slice(0, 3)]);
  }

  const pool = new Set<string>();
  const add = (value: unknown) => {
    const s = String(value ?? "").trim();
    if (s && s !== ans) pool.add(s);
  };

  if (ans.includes("<class")) {
    add(ans.replace(/'str'/g, "'int'"));
    add(ans.replace(/'float'/g, "'str'"));
    add(ans.replace(/'int'/g, "'float'"));
    add(ans.replace(/<class '/g, "").replace(/'>/g, ""));
    add("int float str");
    add(ans.replace("'str'", "'float'"));
  } else if (/^(True|False)( (True|False))*$/.test(ans)) {
    const parts = ans.split(" ");
    add(parts.map((p) => (p === "True" ? "False" : "True")).join(" "));
    add(
      parts
        .map((p, i) => (i === 0 ? (p === "True" ? "False" : "True") : p))
        .join(" "),
    );
    if (parts.length > 1) {
      add(
        parts
          .map((p, i) =>
            i === parts.length - 1 ? (p === "True" ? "False" : "True") : p,
          )
          .join(" "),
      );
    }
  } else if (/^-?[\d.]+( +-?[\d.]+)*$/.test(ans)) {
    const parts = ans.split(/\s+/);
    const nums = parts.map(Number);

    for (let i = 0; i < parts.length; i++) {
      const n = nums[i]!;
      if (!Number.isFinite(n)) continue;
      const one = (next: number | string) => {
        const copy = parts.slice();
        copy[i] = String(next);
        add(copy.join(" "));
      };
      if (n !== 0) one(-n);
      if (parts[i]!.includes(".")) {
        one(Math.trunc(n));
        one(Number((n + Math.sign(n || 1) * 0.01).toFixed(2)));
      } else {
        one(n + ".0");
        one(n + 1);
        one(n - 1);
      }
    }

    if (parts.length >= 2) {
      add(parts.slice().reverse().join(" "));
      add([String(nums[0]! + 1), ...parts.slice(1)].join(" "));
      add([String(nums[0]! - 1), ...parts.slice(1)].join(" "));
    } else {
      add(String(nums[0]! + 1));
      add(String(nums[0]! - 1));
      if (ans.includes(".")) add(ans.replace(/\.0$/, ""));
      else add(ans + ".0");
    }

    add(nums.map((n) => String(n + 1)).join(" "));
    add(nums.map((n) => String(n - 1)).join(" "));
  } else {
    add(ans.toLowerCase());
    add(ans.toUpperCase());
    if (ans.includes("'") && !ans.includes('"')) add(ans.replace(/'/g, '"'));
    if (ans.includes("[") && ans.includes("]")) {
      add(ans.replace("[", "(").replace("]", ")"));
    }
  }

  const wrong = [...pool].filter((x) => x && x !== ans);
  wrong.sort((a, b) => {
    const score = (s: string) => {
      const sameTokens =
        s.split(/\s+/).length === ans.split(/\s+/).length ? 2 : 0;
      const nearLen = Math.abs(s.length - ans.length) <= 2 ? 1 : 0;
      const allShift =
        /^-?[\d.]+( +-?[\d.]+)*$/.test(ans) &&
        s ===
          ans
            .split(/\s+/)
            .map((n) => String(Number(n) + 1))
            .join(" ")
          ? -3
          : 0;
      const allShiftM =
        /^-?[\d.]+( +-?[\d.]+)*$/.test(ans) &&
        s ===
          ans
            .split(/\s+/)
            .map((n) => String(Number(n) - 1))
            .join(" ")
          ? -3
          : 0;
      return sameTokens + nearLen + allShift + allShiftM;
    };
    return score(b) - score(a);
  });
  if (wrong.length < 2) return null;
  return shuffle([ans, ...wrong.slice(0, 3)]);
}
