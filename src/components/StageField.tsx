import { memo, useEffect, useRef } from "react";
import { isScrollBusy, onScrollBusy } from "../lib/scrollBusy";
import type { FxLevel } from "../lib/config";

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/* Nocturne: domain-warped smoke, lit from the edges by each voice's color.
   The speaking voice's light swells; everything else stays near black so
   the transcript keeps its contrast. */
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_w;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

float pool(vec2 p, vec2 at, vec2 stretch, float k) {
  vec2 d = (p - at) * stretch;
  return exp(-dot(d, d) * k);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = u_time * 0.045;

  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)), fbm(p * 1.4 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p * 1.2 + q * 1.9 + vec2(1.7, 9.2) + t * 0.6),
    fbm(p * 1.2 + q * 1.9 + vec2(8.3, 2.8) - t * 0.4)
  );
  float smoke = fbm(p * 1.1 + r * 1.6);

  vec3 col = vec3(0.034, 0.034, 0.037);

  float e = 0.5 * asp;
  vec2 a1 = vec2(-e + 0.08, 0.36) + 0.05 * vec2(sin(t * 2.1), cos(t * 1.7));
  vec2 a2 = vec2(e - 0.06, 0.02) + 0.05 * vec2(cos(t * 1.8), sin(t * 2.3));
  vec2 a3 = vec2(-e * 0.35, -0.58) + 0.05 * vec2(sin(t * 1.5), cos(t * 2.0));
  float g1 = pool(p, a1, vec2(1.0, 1.35), 1.9);
  float g2 = pool(p, a2, vec2(1.2, 0.95), 2.1);
  float g3 = pool(p, a3, vec2(0.9, 1.6), 1.8);

  float veil = 0.35 + 0.95 * smoke * smoke;
  vec3 light = u_c1 * g1 * u_w.x + u_c2 * g2 * u_w.y + u_c3 * g3 * u_w.z;
  col += light * veil * 0.42;
  col += vec3(0.9, 0.92, 1.0) * pow(smoke, 3.0) * 0.085;

  // A cold horizon: faint white lift along the floor of the stage.
  col += vec3(0.8, 0.84, 0.9) * pool(p, vec2(0.0, -0.78), vec2(0.6, 2.6), 2.0) * 0.03;

  float vig = smoothstep(1.3, 0.2, length(p * vec2(0.85, 1.0)));
  col *= 0.7 + 0.3 * vig;

  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * (2.5 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Render at a fraction of CSS pixels — the field is soft anyway. */
const SCALE = 0.5;
/** Frame budget for the "full" living loop (~30fps). */
const FRAME_MS = 33;
/** Crossfade between lighting states in "balanced". */
const FADE_MS = 1400;
/** How far the smoke drifts on each speaker change. */
const DRIFT = 1.1;
const REST = 0.55;
const FOCUS = 1.55;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Scene = { t: number; rgb: number[][]; w: number[] };

type Renderer = {
  canvas: HTMLCanvasElement;
  resize: (w: number, h: number) => void;
  draw: (s: Scene) => void;
  dispose: () => void;
};

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uC = ["u_c1", "u_c2", "u_c3"].map((n) => gl.getUniformLocation(prog, n));
  const uW = gl.getUniformLocation(prog, "u_w");

  return {
    canvas,
    resize(w, h) {
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    draw(sc) {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, 12 + sc.t);
      for (let i = 0; i < 3; i++) gl.uniform3f(uC[i], sc.rgb[i][0], sc.rgb[i][1], sc.rgb[i][2]);
      gl.uniform3f(uW, sc.w[0], sc.w[1], sc.w[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    },
  };
}

interface Props {
  /** Voice colors in slot order (2 or 3). */
  colors: string[];
  /** Index into `colors` of the voice that is speaking / up next, or -1. */
  focus: number;
  fx: FxLevel;
}

function targets(colors: string[], focus: number) {
  const rgb = [0, 1, 2].map((i) => (colors[i] ? hexRgb(colors[i]) : [0, 0, 0]));
  const w = [0, 1, 2].map((i) =>
    !colors[i] ? 0 : focus < 0 ? REST : i === focus ? FOCUS : REST * 0.7,
  );
  return { rgb, w };
}

type Engine = {
  set: (colors: string[], focus: number, fx: FxLevel) => void;
};

/**
 * Nocturne stage. Cost model, cheapest first:
 * - lite / reduced motion: one draw per change, no motion at all.
 * - balanced: one draw per speaker change into the hidden canvas, then a
 *   CSS opacity crossfade — the compositor does the animation, the GPU draws
 *   a single frame. No per-frame shader work, even on software GL.
 * - full: a living ~30fps loop, paused while scrolling or hidden.
 */
function StageField({ colors, focus, fx }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLCanvasElement>(null);
  const bRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const colorKey = colors.join(",");

  useEffect(() => {
    const wrap = wrapRef.current;
    const ca = aRef.current;
    const cb = bRef.current;
    if (!wrap || !ca || !cb) return;
    const ra = createRenderer(ca);
    const rb = createRenderer(cb);
    if (!ra || !rb) return;

    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let front = ra;
    let back = rb;
    let fade: Animation | null = null;
    let level: FxLevel = "balanced";
    const target = targets([], -1);
    const cur: Scene = { t: 0, rgb: target.rgb.map((c) => [...c]), w: [...target.w] };

    front.canvas.style.zIndex = "1";
    back.canvas.style.zIndex = "0";

    const still = () => motionMq.matches || level === "lite";

    const size = () => {
      const w = Math.max(1, Math.floor(wrap.clientWidth * SCALE));
      const h = Math.max(1, Math.floor(wrap.clientHeight * SCALE));
      ra.resize(w, h);
      rb.resize(w, h);
    };

    const snap = () => {
      cur.w = [...target.w];
      cur.rgb = target.rgb.map((c) => [...c]);
    };

    // ── balanced: draw once into the hidden canvas, crossfade on top ──
    const crossfade = () => {
      snap();
      cur.t += DRIFT;
      back.draw(cur);
      fade?.cancel();
      back.canvas.style.zIndex = "1";
      front.canvas.style.zIndex = "0";
      fade = back.canvas.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: FADE_MS,
        easing: "cubic-bezier(0.33, 1, 0.68, 1)",
      });
      [front, back] = [back, front];
    };

    // ── full: living loop on the front canvas ──
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let scrolling = isScrollBusy();
    let last = performance.now();

    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer != null) clearTimeout(timer);
      raf = 0;
      timer = null;
    };
    const looping = () =>
      level === "full" && !still() && !document.hidden && !scrolling;
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!looping()) return;
      const k = 1 - Math.exp(-dt / 0.35);
      for (let i = 0; i < 3; i++) {
        cur.w[i] += (target.w[i] - cur.w[i]) * k;
        for (let j = 0; j < 3; j++) cur.rgb[i][j] += (target.rgb[i][j] - cur.rgb[i][j]) * k;
      }
      cur.t += dt;
      front.draw(cur);
      loop();
    };
    const loop = () => {
      if (raf || timer != null || !looping()) return;
      timer = setTimeout(() => {
        timer = null;
        raf = requestAnimationFrame(tick);
      }, FRAME_MS);
    };

    const render = (changed: boolean) => {
      if (looping()) {
        last = performance.now();
        loop();
        return;
      }
      stopLoop();
      if (still() || !changed) {
        snap();
        front.draw(cur);
        return;
      }
      crossfade();
    };

    engineRef.current = {
      set(nextColors, nextFocus, nextFx) {
        const t = targets(nextColors, nextFocus);
        const changed =
          t.w.some((v, i) => v !== target.w[i]) ||
          t.rgb.some((c, i) => c.some((v, j) => v !== target.rgb[i][j]));
        target.w = t.w;
        target.rgb = t.rgb;
        const levelChanged = nextFx !== level;
        level = nextFx;
        if (changed || levelChanged) render(changed);
      },
    };

    size();
    snap();
    front.draw(cur);
    wrap.classList.add("is-ready");

    const ro = new ResizeObserver(() => {
      size();
      front.draw(cur);
    });
    ro.observe(wrap);

    const onVis = () => {
      if (looping()) {
        last = performance.now();
        loop();
      } else stopLoop();
    };
    const unscroll = onScrollBusy((v) => {
      scrolling = v;
      onVis();
    });
    document.addEventListener("visibilitychange", onVis);
    motionMq.addEventListener("change", onVis);

    return () => {
      stopLoop();
      fade?.cancel();
      engineRef.current = null;
      ro.disconnect();
      unscroll();
      document.removeEventListener("visibilitychange", onVis);
      motionMq.removeEventListener("change", onVis);
      ra.dispose();
      rb.dispose();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.set(colorKey ? colorKey.split(",") : [], focus, fx);
  }, [colorKey, focus, fx]);

  return (
    <div className="stage" ref={wrapRef} aria-hidden>
      <canvas ref={aRef} />
      <canvas ref={bRef} />
    </div>
  );
}

export default memo(StageField);
