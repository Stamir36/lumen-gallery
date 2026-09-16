import { useEffect } from "react";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { Onboarding } from "@/pages/Onboarding";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";
import { useNavigate } from "react-router-dom";

/** QA route: /#/onboarding — the root picker without waiting for first run. */
export default function OnboardingRoute() {
  const navigate = useNavigate();
  const load = useRootsStore((s) => s.load);

  useEffect(() => {
    getDb()
      .catch(() => undefined)
      .then(() => load());
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar leftAction={<span className="font-mono text-xs text-ttertiary">v0.1</span>} />
      <div className="min-h-0 flex-1">
        <Onboarding onDone={() => navigate("/")} />
      </div>
    </div>
  );
}
