import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldApplyAbort, shouldShowContentBubble } from "./streamEpoch.ts";

describe("shouldApplyAbort", () => {
  it("applies legacy aborts without epoch", () => {
    assert.equal(shouldApplyAbort(undefined, 5), true);
  });
  it("ignores abort older than last stream-start", () => {
    assert.equal(shouldApplyAbort(4, 5), false);
  });
  it("applies abort at or after last stream-start", () => {
    assert.equal(shouldApplyAbort(5, 5), true);
    assert.equal(shouldApplyAbort(6, 5), true);
  });
});

describe("shouldShowContentBubble", () => {
  it("always shows when content exists", () => {
    assert.equal(
      shouldShowContentBubble({
        content: "hi",
        reasoning: "think",
        streaming: true,
        showThoughtsUi: true,
      }),
      true,
    );
  });
  it("hides empty bubble while reasoning-only stream (thoughts on)", () => {
    assert.equal(
      shouldShowContentBubble({
        content: "",
        reasoning: "think",
        streaming: true,
        showThoughtsUi: true,
      }),
      false,
    );
  });
  it("still hides empty bubble while reasoning-only stream (thoughts off)", () => {
    // Prevents layout thrash when toggling showThoughtsUi mid-stream.
    assert.equal(
      shouldShowContentBubble({
        content: "",
        reasoning: "think",
        streaming: true,
        showThoughtsUi: false,
      }),
      false,
    );
  });
  it("shows empty bubble when streaming with no reasoning yet", () => {
    assert.equal(
      shouldShowContentBubble({
        content: "",
        reasoning: "",
        streaming: true,
        showThoughtsUi: true,
      }),
      true,
    );
  });
});
