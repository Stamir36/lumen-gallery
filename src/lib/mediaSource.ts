import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/api";
import { fileSrc, tauriAvailable } from "@/lib/assets";
import { useAppSettings } from "@/lib/settings";

export interface MediaSource {
  /** ready-to-use <video src>; empty string while resolving */
  src: string;
  /**
   * true when frames come from the loopback CORS server (canvas-clean:
   * frame screenshots + VR dome work). false = asset protocol (tainted
   * canvas: screenshots hidden, VR falls back).
   */
  clean: boolean;
}

/**
 * ONE source policy for every video surface (main player, mini player,
 * collage tiles): the loopback CORS server is the DEFAULT — with its
 * multi-threaded worker pool it streams fine and keeps frames canvas-clean
 * (frame screenshots + VR dome). "Direct playback" (Settings › Playback)
 * bypasses the server and serves the file through the asset protocol.
 */
export function useMediaSource(path: string | null | undefined): MediaSource {
  const direct = useAppSettings((s) => s.directPlayback);
  const [state, setState] = useState<MediaSource>({ src: "", clean: false });

  useEffect(() => {
    if (!path) {
      setState({ src: "", clean: false });
      return;
    }
    // asset protocol: no round trip, the URL is derived synchronously
    if (!direct || !tauriAvailable()) {
      // server path (the default): resolve through media_url
      let cancelled = false;
      mediaUrl(path)
        .then((u) => {
          if (!cancelled) setState({ src: u, clean: true });
        })
        .catch((e) => {
          console.warn("media server unavailable — asset fallback (snapshot disabled)", e);
          if (!cancelled) setState({ src: fileSrc(path), clean: false });
        });
      return () => {
        cancelled = true;
      };
    }
    // direct playback: the asset protocol, derived synchronously
    setState({ src: fileSrc(path), clean: false });
    return;
  }, [path, direct]);

  return state;
}
