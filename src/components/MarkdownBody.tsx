import { memo, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamMode } from "../lib/config";
import { openExternal } from "../lib/api";

const REMARK_PLUGINS = [remarkGfm];

const MD_COMPONENTS = {
  // A plain link would navigate the app's own window away from the chat
  // (with no Back on desktop). Send web links to the system browser.
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^(https?:|mailto:)/i.test(href)) void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

/** Finished markdown. Memoized on the string, so a streaming reply only
 *  re-parses when a new block completes — not on every token. */
const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {content || " "}
    </ReactMarkdown>
  );
});

/**
 * Split a growing reply into blocks that are safe to render as markdown and
 * the unfinished tail. A block is done at a blank line, unless that blank
 * line sits inside an open code fence.
 */
export function splitStable(content: string): { stable: string; tail: string } {
  let cut = content.lastIndexOf("\n\n");
  while (cut > 0) {
    const head = content.slice(0, cut);
    const fences = head.match(/^```/gm)?.length ?? 0;
    if (fences % 2 === 0) {
      return { stable: head, tail: content.slice(cut + 2) };
    }
    cut = content.lastIndexOf("\n\n", cut - 1);
  }
  return { stable: "", tail: content };
}

/** Top-level blocks of finished markdown (blank-line separated, fences kept
 *  whole). Each renders on its own, so a new block mounts — and animates —
 *  exactly once. */
function splitBlocks(stable: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let fenced = false;
  for (const line of stable.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "" && buf.length) {
      out.push(buf.join("\n"));
      buf = [];
      continue;
    }
    buf.push(line);
  }
  if (buf.length) out.push(buf.join("\n"));
  return out.filter((b) => b.trim());
}

type Chunk = { at: number; text: string };

/** Live tail: each flush's new text becomes its own span that inks in. */
function InkTail({ text }: { text: string }) {
  const ref = useRef<{ text: string; chunks: Chunk[] }>({ text: "", chunks: [] });
  const prev = ref.current;
  if (text !== prev.text) {
    if (text.startsWith(prev.text) && prev.text) {
      const add = text.slice(prev.text.length);
      let chunks = [...prev.chunks, { at: prev.text.length, text: add }];
      // Old chunks have finished animating; fold them into one plain run.
      if (chunks.length > 18) {
        const keep = chunks.slice(-12);
        const folded = chunks
          .slice(0, -12)
          .map((c) => c.text)
          .join("");
        chunks = [{ at: -1, text: folded }, ...keep];
      }
      ref.current = { text, chunks };
    } else {
      ref.current = { text, chunks: text ? [{ at: 0, text }] : [] };
    }
  }
  const { chunks } = ref.current;
  return (
    <div className="md-plain md-tail">
      {chunks.map((c) =>
        c.at < 0 ? (
          <span key="base">{c.text}</span>
        ) : (
          <span key={c.at} className="tok">
            {c.text}
          </span>
        ),
      )}
      <span className="stream-caret" aria-hidden />
    </div>
  );
}

function Composing({ label }: { label: string }) {
  return (
    <div className="composing" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </div>
  );
}

function MarkdownBody({
  content,
  streaming,
  mode = "live",
}: {
  content: string;
  streaming?: boolean;
  mode?: StreamMode;
}) {
  if (!streaming) {
    return (
      <div className="md-body">
        <Markdown content={content} />
      </div>
    );
  }

  const { stable, tail } = splitStable(content);

  if (mode === "whole") {
    return (
      <div className="md-body md-streaming">
        <Composing label="Writing the whole reply" />
      </div>
    );
  }

  if (mode === "paragraph") {
    return (
      <div className="md-body md-streaming">
        {splitBlocks(stable).map((block, i) => (
          <div className="md-block" key={i}>
            <Markdown content={block} />
          </div>
        ))}
        {tail.trim() && <Composing label="Writing the next paragraph" />}
      </div>
    );
  }

  return (
    <div className="md-body md-streaming">
      {stable && <Markdown content={stable} />}
      <InkTail text={tail} />
    </div>
  );
}

export default memo(MarkdownBody);
