/** Dev utility: prints library stats from the LUMEN sqlite file. */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const file = path.join(process.env.APPDATA, "app.lumen.gallery", "lumen.db");
const db = new DatabaseSync(file, { readOnly: true });
const one = (sql) => db.prepare(sql).get();

console.log("media total  :", one("select count(*) c from media").c);
console.log("images       :", one("select count(*) c from media where kind='image'").c);
console.log("videos       :", one("select count(*) c from media where kind='video'").c);
console.log("thumbs ready :", one("select count(*) c from media where thumb_path is not null").c);
console.log("offline      :", one("select count(*) c from media where offline=1").c);
console.log("roots        :", one("select count(*) c from roots").c);
