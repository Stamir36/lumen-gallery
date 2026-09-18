/**
 * One-off repair for mojibake that PowerShell's CP1251 console decoding left in
 * source files (UTF-8 bytes of —, ·, × … decoded as CP1251). The map is written
 * with \u escapes so this script itself is ASCII-only and encoding-proof.
 *
 * Usage: node scripts/fix-mojibake.cjs <file...>
 */
const fs = require("node:fs");

const MAP = [
  ["\u0432\u0402\u201d", "\u2014"], // em dash
  ["\u0432\u0402\u201c", "\u2013"], // en dash
  ["\u0412\u00b7", "\u00b7"], // middle dot
  ["\u0413\u2014", "\u00d7"], // multiplication sign
  ["\u0432\u20ac\u2019", "\u2212"], // minus
  ["\u0432\u2020\u2019", "\u2192"], // arrow
  ["\u0432\u0402\u00a6", "\u2026"], // ellipsis
  ["\u0432\u2030\u0490", "\u2265"], // >=
  ["\u0432\u2030\u00a4", "\u2264"], // <=
  ["\u0432\u0402\u045a", "\u201c"], // left double quote
  ["\u0432\u0402\u045d", "\u201d"], // right double quote
  ["\u0432\u0402\u02dc", "\u2018"], // left single quote
  ["\u0432\u0402\u2122", "\u2019"], // right single quote
  ["\u0432\u2030\u20ac", "\u2248"], // approx
];

let fixed = 0;
for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, "utf8");
  let text = before;
  for (const [bad, good] of MAP) {
    if (text.includes(bad)) {
      const n = text.split(bad).length - 1;
      fixed += n;
      console.log(`${file}: ${n} x ${JSON.stringify(bad)} -> ${JSON.stringify(good)}`);
      text = text.split(bad).join(good);
    }
  }
  if (text !== before) fs.writeFileSync(file, text, "utf8");
  const leftovers = text.match(/[\u0400-\u04ff]+/g);
  console.log(
    `${file}: ${leftovers ? `${leftovers.length} unresolved cyrillic run(s): ${[...new Set(leftovers)].slice(0, 8).join(" ")}` : "clean"}`,
  );
}
console.log(`total replacements: ${fixed}`);
