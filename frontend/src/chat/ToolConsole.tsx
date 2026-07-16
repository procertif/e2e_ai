import { useStickyScroll } from "../utils/useStickyScroll";

// RunTest live console inside a chat turn — keeps the view pinned to the
// latest lines as output streams in (unless the user scrolled up).
export function ToolConsole({ text }: { text: string }) {
  const ref = useStickyScroll<HTMLPreElement>(text);
  return (
    <pre className="tool-console" ref={ref}>
      {text}
    </pre>
  );
}
