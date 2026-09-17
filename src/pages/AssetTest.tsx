import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileSrc } from "@/lib/assets";

/**
 * TEMP dev route (#/asset-test): verifies the asset protocol serves real local
 * files. Removed once the grid renders real media (STEP 3).
 */
export default function AssetTest() {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ path: string }[]>("list_media", { limit: 1, offset: 0 })
      .then((rows) => {
        if (!rows.length) {
          setErr("no media rows");
          return;
        }
        setSrc(fileSrc(rows[0].path));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas">
      <h1 className="text-lg font-semibold text-tprimary">asset protocol test</h1>
      {err && <p className="text-danger">{err}</p>}
      {src && (
        <img
          src={src}
          alt="asset test"
          className="max-h-[70vh] max-w-[80vw] rounded-card"
          onError={() => setErr("asset protocol refused the file")}
        />
      )}
      {src && <p className="font-mono text-[11px] text-ttertiary">{src}</p>}
    </div>
  );
}