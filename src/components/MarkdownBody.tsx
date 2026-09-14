import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

function MarkdownBody({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  // Mid-stream markdown is unstable (half fences, half bold). Show plain text
  // while streaming so SSE output doesn't glitch.
  if (streaming) {
    return (
      <div className="md-body md-streaming">
        <div className="md-plain">{content || ""}</div>
        <span className="stream-caret" aria-hidden />
      </div>
    );
  }

  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
        {content || " "}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBody);
