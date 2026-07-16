import { useEffect, useRef, type RefObject } from "react";

// Attach to whatever element actually scrolls (needs overflow-y auto/scroll)
// — auto-scrolls to the bottom on mount and whenever `dep` changes, but only
// while the user hasn't scrolled away from the bottom themselves. Once they
// scroll up, new content (a growing console, a streaming chat reply) no
// longer yanks them back down; scrolling back to the bottom re-arms it.
// Pass an existing ref (e.g. one shared via a context that outlives this
// component) to attach the same tracking to it instead of creating a new one.
// resetKey re-arms stuck-to-bottom on change — for a component reused across
// different subjects without remounting (e.g. the same chat panel switching
// between tests), otherwise a stale "scrolled up" from the PREVIOUS subject
// would silently carry over and suppress the new one's initial scroll.
export function useStickyScroll<T extends HTMLElement>(dep: unknown, existingRef?: RefObject<T | null>, resetKey?: unknown) {
  const ownRef = useRef<T | null>(null);
  const ref = existingRef || ownRef;
  const stuckToBottom = useRef(true);
  const lastResetKey = useRef(resetKey);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (resetKey !== lastResetKey.current) {
      lastResetKey.current = resetKey;
      stuckToBottom.current = true;
    }
    const el = ref.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [dep, resetKey]);

  return ref;
}
