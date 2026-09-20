import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EST_MSG,
  GAP,
  buildPrefixes,
  bottomPinnedWindow,
  computeVirtualWindow,
  estimateMessageHeight,
  nearBottom,
  scrollAnchorDelta,
  slicePads,
} from "./chatVirtual.ts";

describe("estimateMessageHeight", () => {
  it("returns base for empty-ish messages", () => {
    const h = estimateMessageHeight({ content: "" });
    assert.ok(h >= 96);
    assert.ok(h <= EST_MSG + 40);
  });

  it("grows with long content but stays capped", () => {
    const short = estimateMessageHeight({ content: "hi" });
    const long = estimateMessageHeight({ content: "x".repeat(4000) });
    assert.ok(long > short);
    assert.ok(long <= 1400);
  });

  it("adds thoughts toggle and open body", () => {
    const closed = estimateMessageHeight({
      content: "hello",
      reasoning: "thinking hard about stuff ".repeat(20),
    });
    const open = estimateMessageHeight(
      {
        content: "hello",
        reasoning: "thinking hard about stuff ".repeat(20),
      },
      true,
    );
    assert.ok(open > closed);
  });

  it("accounts for streaming caret padding", () => {
    const idle = estimateMessageHeight({ content: "ab" });
    const live = estimateMessageHeight({ content: "ab", streaming: true });
    assert.ok(live >= idle);
  });
});

describe("computeVirtualWindow", () => {
  const count = 40;
  const prefixes = buildPrefixes(count, () => EST_MSG + GAP);

  it("covers the viewport with overscan", () => {
    const win = computeVirtualWindow({
      scrollTop: 2000,
      clientHeight: 600,
      count,
      prefixes,
      overscan: 2,
    });
    assert.ok(win.start < win.end);
    assert.ok(win.end - win.start >= 3);
    assert.ok(win.start >= 0);
    assert.ok(win.end <= count);
  });

  it("pinEnd forces the live/streaming tail into the window", () => {
    const win = computeVirtualWindow({
      scrollTop: 0,
      clientHeight: 400,
      count,
      prefixes,
      overscan: 1,
      pinEnd: true,
    });
    assert.equal(win.end, count);
  });

  it("handles empty list", () => {
    assert.deepEqual(
      computeVirtualWindow({
        scrollTop: 0,
        clientHeight: 400,
        count: 0,
        prefixes: [0],
      }),
      { start: 0, end: 0 },
    );
  });
});

describe("bottomPinnedWindow", () => {
  it("pins the last rows", () => {
    const win = bottomPinnedWindow(30, 500, EST_MSG + GAP, 2);
    assert.equal(win.end, 30);
    assert.ok(win.start < 30);
    assert.ok(win.start >= 0);
  });
});

describe("scrollAnchorDelta / slicePads", () => {
  it("reports prefix growth above the anchor", () => {
    const oldP = [0, 100, 200, 300];
    const newP = [0, 100, 280, 380];
    assert.equal(scrollAnchorDelta(oldP, newP, 2), 80);
    assert.equal(scrollAnchorDelta(oldP, newP, 1), 0);
  });

  it("builds pads from prefixes", () => {
    const prefixes = [0, 100, 200, 300, 400];
    const pads = slicePads(4, 1, 3, prefixes);
    assert.equal(pads.topPad, 100);
    assert.equal(pads.bottomPad, 100);
  });
});

describe("nearBottom", () => {
  it("detects stick zone", () => {
    assert.equal(nearBottom(1000, 900, 100, 50), true);
    assert.equal(nearBottom(1000, 100, 100, 50), false);
  });
});
