/**
 * Toast: thin opinionated wrapper over sonner.
 * <Toaster /> is mounted once in main.tsx with token-matched styling.
 * Usage: import { toast } from "sonner"; toast("Saved");
 * Variants: toast.success / toast.error / toast.warning map to
 * success/danger/warning tokens via sonner's icon API at call sites.
 */
export { toast, Toaster } from "sonner";
