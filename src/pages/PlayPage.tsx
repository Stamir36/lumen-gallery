import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowLeft, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Segmented } from "@/components/ui/Segmented";
import { formatCount } from "@/lib/api";
import { enqueueThumbs, thumbSrc, useThumbStore } from "@/lib/thumbs";
import { useMediaRows } from "@/lib/queries";
import { filterForRoute, useLibraryUi } from "@/state/library-ui";
import { useAppSettings } from "@/lib/settings";

/**
 * EASTER EGG — «Память» (the mini-game behind the 5-logo-click gesture).
 * HIDDEN on purpose: no card on the Tools hub, no link anywhere in the UI —
 * it is reachable only by typing the /play route. Do not surface it.
 *
 * The deck is the user's OWN library: thumbnails that already exist in the
 * cache, so a round costs no disk reads beyond the previews the grid would
 * have generated anyway. The 3D comes from CSS transforms only (perspective on
 * the board, `rotateY` per card) — no 3D engine, and it collapses to a plain
 * fade when the user turned micro-motion off.
 *
 * STABILITY CONTRACT: the deck is SNAPSHOT INTO STATE when a round starts and
 * is never rebuilt from live query data. A background media refetch (window
 * focus, thumb patches, keepPreviousData) changes the `media.data` identity
 * every few seconds, and a deck derived via useMemo from that identity was
 * re-dealt mid-game — the user saw the board reshuffle "by itself". The query
 * below is only the POOL a new round deals from; the round itself owns its
 * cards.
 */

type Card = {
  /** stable per-instance key */
  key: string;
  /** the media id this card was cut from */
  id: number;
  /** the thumbnail path handed to thumbSrc */
  path: string;
};

type Board = 8 | 12 | 18;

const BOARDS: { value: Board; label: string }[] = [
  { value: 8, label: "8" },
  { value: 12, label: "12" },
  { value: 18, label: "18" },
];

/** Fisher–Yates: an unbiased shuffle, unlike sort(() => Math.random() - .5). */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function PlayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const uiMotion = useAppSettings((s) => s.uiMotion);
  const route = useLibraryUi((s) => s.route);
  const chip = useLibraryUi((s) => s.chip);
  const q = useLibraryUi((s) => s.q);
  const sort = useLibraryUi((s) => s.sort);
  const desc = useLibraryUi((s) => s.desc);

  const [pairs, setPairs] = useState<Board>(8);
  /** the round's cards — set once per deal, never derived from live data */
  const [deck, setDeck] = useState<Card[]>([]);
  /** ids of the cards currently face up (max 2) */
  const [flipped, setFlipped] = useState<string[]>([]);
  /** ids already matched — they stay face up and stop answering clicks */
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  /** re-deal has to wait until the library rows are actually available */
  const [dealWhenReady, setDealWhenReady] = useState(false);
  /** keeps the flip-back timer honest when the user restarts mid-turn */
  const timeout = useRef<number | null>(null);

  // The POOL the game deals from: images from the CURRENT library view. Only
  // read when (re)dealing — identity churn here must never touch the board.
  const media = useMediaRows({
    filter: filterForRoute(route, chip),
    sort,
    desc,
    q,
    rootId: route.kind === "root" ? route.rootId : null,
    dir: route.kind === "root" ? route.dir : null,
    enabled: true,
  });

  const thumbs = useThumbStore((s) => s.thumbs);

  /** Deal a fresh round from the current pool. */
  const deal = useCallback(
    (want: Board) => {
      const rows = (media.data ?? []).filter((r) => r.kind === "image" && !r.trashed);
      if (rows.length < 2) {
        setDeck([]);
        setDealWhenReady(true); // rows may still be loading — try again when they land
        return;
      }
      const picked = shuffle(rows).slice(0, Math.min(want, rows.length));
      if (picked.length < want) {
        setDeck([]);
        return;
      }
      const cards: Card[] = [];
      picked.forEach((row, i) => {
        // two cards per photo; the key carries the pair index so React never
        // reuses a DOM node across the pair (that would kill the flip animation)
        cards.push({ key: `a${i}-${row.id}`, id: row.id, path: row.path });
        cards.push({ key: `b${i}-${row.id}`, id: row.id, path: row.path });
      });
      setDeck(shuffle(cards));
      setFlipped([]);
      setMatched(new Set());
      setMoves(0);
      setDealWhenReady(false);
    },
    [media.data],
  );

  // Board-size change deals immediately with the NEW count (the Segmented
  // callback passes it explicitly — setState alone would race `deal`).
  const changePairs = (next: Board) => {
    setPairs(next);
    deal(next);
  };

  // First deal: once the pool first has enough rows (covers the cold start,
  // where the query answer lands after mount). Later pool changes are IGNORED
  // — that was the self-restart bug.
  const poolSize = (media.data ?? []).filter((r) => r.kind === "image" && !r.trashed).length;
  const dealtRef = useRef(false);
  useEffect(() => {
    if (dealtRef.current || deck.length > 0) return;
    if (dealWhenReady && poolSize >= 2) {
      dealtRef.current = true;
      deal(pairs);
    }
  }, [dealWhenReady, poolSize, deal, pairs, deck.length]);

  // previews for the deck: the finder/slideshow contract — ask once per id
  const asked = useRef<Set<number>>(new Set());
  useEffect(() => {
    const missing: number[] = [];
    for (const card of deck) {
      if (asked.current.has(card.id)) continue;
      asked.current.add(card.id);
      const known = thumbs[card.id];
      if (!(known && known.status === "ok")) missing.push(card.id);
    }
    if (missing.length > 0) enqueueThumbs(missing);
  }, [deck, thumbs]);

  // a wrong pair turns back after a beat the player can actually see
  useEffect(() => {
    if (flipped.length !== 2) return;
    const [a, b] = flipped;
    const cardA = deck.find((c) => c.key === a);
    const cardB = deck.find((c) => c.key === b);
    const isPair = cardA && cardB && cardA.id === cardB.id;
    const delay = isPair ? 380 : 780;
    timeout.current = window.setTimeout(() => {
      if (isPair) setMatched((m) => new Set(m).add(a).add(b));
      setFlipped([]);
    }, delay);
    return () => {
      if (timeout.current) window.clearTimeout(timeout.current);
    };
  }, [flipped, deck]);

  const start = useCallback(() => {
    deal(pairs);
  }, [deal, pairs]);

  const reveal = (card: Card) => {
    if (matched.has(card.key) || flipped.includes(card.key) || flipped.length === 2) return;
    setFlipped((f) => {
      const next = [...f, card.key];
      if (next.length === 2) setMoves((m) => m + 1);
      return next;
    });
  };

  const won = deck.length > 0 && matched.size === deck.length;

  return (
    <div className="flex h-full flex-col bg-surface-1">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <IconButton label={t("actions.back")} onClick={() => navigate("/tools")}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="micro-label">{t("play.title")}</span>
        <Segmented
          aria-label={t("play.pairs")}
          size="sm"
          tone="quiet"
          className="ml-2"
          value={String(pairs)}
          onChange={(v) => changePairs(Number(v) as Board)}
          options={BOARDS.map((b) => ({ value: String(b.value), label: b.label }))}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-ttertiary">
            {t("play.moves", { count: formatCount(moves) })}
          </span>
          <IconButton label={t("play.restart")} onClick={start}>
            <RotateCcw size={18} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {/* perspective wrapper: every card turns in the same 3D space, which is
            what makes the flip read as a physical card rather than a fade */}
        <div
          className="mx-auto max-w-[880px]"
          style={{ perspective: uiMotion ? "1400px" : undefined }}
        >
          {deck.length === 0 ? (
            <p className="py-24 text-center text-sm text-tsecondary">
              {media.isPending ? t("play.loading") : t("play.need_photos")}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              {deck.map((card, i) => {
                const known = thumbs[card.id];
                const src = known && known.status === "ok" ? (known.path ?? null) : card.path;
                const faceUp = flipped.includes(card.key) || matched.has(card.key);
                const done = matched.has(card.key);
                return (
                  <motion.button
                    key={card.key}
                    type="button"
                    onClick={() => reveal(card)}
                    aria-label={faceUp ? t("play.card_open") : t("play.card_closed")}
                    initial={uiMotion ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: uiMotion ? Math.min(i * 0.02, 0.3) : 0, duration: 0.2 }}
                    // NO whileHover y-lift: framer owns `transform` on the
                    // button, and the lift read as the board "jumping" between
                    // re-renders. The shadow is the hover affordance now.
                    whileTap={uiMotion ? { scale: 0.97 } : undefined}
                    className={cn(
                      "relative aspect-[3/4] rounded-card outline-none",
                      "transition-shadow duration-[160ms]",
                      done && "shadow-[0_0_0_1px_var(--accent-soft),0_8px_24px_rgba(0,0,0,.4)]",
                      !faceUp && "hover:shadow-[0_12px_28px_rgba(0,0,0,.4)]",
                    )}
                  >
                    {/* the flip lives on an INNER layer on purpose: framer-motion
                        owns `transform` on the button, so a rotateY set there was
                        overwritten and the cards never turned */}
                    <span
                      className="absolute inset-0 block"
                      style={{
                        transformStyle: "preserve-3d",
                        transform: faceUp ? "rotateY(180deg)" : "rotateY(0deg)",
                        transition: uiMotion
                          ? "transform 420ms cubic-bezier(.22,1,.36,1)"
                          : "none",
                      }}
                    >
                      {/* back of the card — the LUMEN mark (visible at rest) */}
                      <span
                        className="absolute inset-0 flex items-center justify-center rounded-card bg-surface-2 ring-1 ring-white/[.05]"
                        style={{ backfaceVisibility: "hidden" }}
                      >
                        <Sparkles
                          size={22}
                          className={cn(
                            "transition-colors",
                            done ? "text-accent" : "text-ttertiary",
                          )}
                        />
                      </span>
                      {/* face — the user's photo */}
                      <span
                        className="absolute inset-0 overflow-hidden rounded-card bg-surface-3"
                        style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                      >
                        {src ? (
                          <img
                            src={thumbSrc(src)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full select-none object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center">
                            <Sparkles size={18} className="text-ttertiary" />
                          </span>
                        )}
                        {done && <span className="absolute inset-0 bg-accent/[.12]" aria-hidden />}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* win state: replaces the prose, keeps the board in place */}
        {won && (
          <motion.div
            initial={uiMotion ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mt-8 flex max-w-[880px] flex-wrap items-center justify-center gap-4 rounded-card bg-surface-2 px-6 py-5 text-center shadow-[0_8px_24px_rgba(0,0,0,.35)]"
          >
            <Trophy size={20} className="text-accent" />
            <span className="text-sm text-tprimary">
              {t("play.won", { count: formatCount(moves) })}
            </span>
            <button
              type="button"
              onClick={start}
              className="rounded-pill bg-accent px-4 py-1.5 text-[12px] text-black transition-colors hover:bg-accent/85"
            >
              {t("play.again")}
            </button>
          </motion.div>
        )}

        <p className="mx-auto mt-8 max-w-[880px] text-center text-[12px] leading-relaxed text-ttertiary">
          {t("play.hint")}
        </p>
      </div>
    </div>
  );
}
