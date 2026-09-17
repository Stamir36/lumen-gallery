import { create } from "zustand";
import { QueryClient } from "@tanstack/react-query";

/** Shared cache for every library query (grid, folders, summary). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

/** Lightweight zustand factory kept next to the client for view-model slices. */
export { create as createStore };
