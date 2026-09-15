import { Link } from "react-router-dom";

/**
 * App shell. Phase 1: minimal placeholder home — the real library UI
 * arrives in Phase 3. Design system lives at /style.
 */
export default function App() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 border border-dashed border-hairline-hover rounded-card px-24 py-16">
        <span className="micro-label">Lumen</span>
        <h1 className="text-xl font-semibold text-tprimary">LUMEN</h1>
        <p className="text-sm text-tsecondary">
          Local-first photo &amp; video gallery
        </p>
        <Link
          to="/style"
          className="inline-flex h-8 items-center rounded-pill border border-hairline-hover px-4 text-sm text-tsecondary transition-colors duration-[160ms] hover:bg-surface-2 hover:text-tprimary"
        >
          Design system → /style
        </Link>
      </div>
    </div>
  );
}
