import { memo, useEffect, useRef } from "react";
import { isScrollBusy, onScrollBusy } from "../lib/scrollBusy";
import type { FxLevel } from "../lib/config";
import type { ShaderPreset } from "../lib/background";

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const COMMON = `
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

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

/* Each voice owns a pool of light at the stage's edges; the speaker's
   swells. Returned as brightness only — the stage is pure greyscale. */
float voiceLight(vec2 p, float asp, float t) {
  float e = 0.5 * asp;
  vec2 a1 = vec2(-e + 0.08, 0.36) + 0.05 * vec2(sin(t * 2.1), cos(t * 1.7));
  vec2 a2 = vec2(e - 0.06, 0.02) + 0.05 * vec2(cos(t * 1.8), sin(t * 2.3));
  vec2 a3 = vec2(-e * 0.35, -0.58) + 0.05 * vec2(sin(t * 1.5), cos(t * 2.0));
  float g1 = pool(p, a1, vec2(1.0, 1.35), 1.9);
  float g2 = pool(p, a2, vec2(1.2, 0.95), 2.1);
  float g3 = pool(p, a3, vec2(0.9, 1.6), 1.8);
  return dot(u_c1, LUM) * g1 * u_w.x + dot(u_c2, LUM) * g2 * u_w.y + dot(u_c3, LUM) * g3 * u_w.z;
}

/* Portrait screens pack the light behind the text; dim them. */
float gainFor(float asp) {
  return mix(0.5, 1.0, smoothstep(0.55, 1.25, asp));
}

vec4 finish(vec3 col, vec2 p) {
  float vig = smoothstep(1.3, 0.2, length(p * vec2(0.85, 1.0)));
  col *= 0.72 + 0.28 * vig;
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * (2.5 / 255.0);
  return vec4(col, 1.0);
}

`;

/* Every preset is greyscale, lit by the voices' brightness, and cheap
   enough at half resolution to run on software GL. */
const PRESETS: Record<ShaderPreset, string> = {
  /* Domain-warped smoke under one wide diagonal sweep of light. */
  nocturne: `
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
  float veil = 0.35 + 0.95 * smoke * smoke;
  float v = voiceLight(p, asp, t) * veil * 0.36 + pow(smoke, 3.0) * 0.07;
  float sweep = dot(p, normalize(vec2(0.55, -1.0)));
  v += smoothstep(0.9, -0.7, sweep) * 0.045;
  vec3 col = vec3(mix(0.012, 0.04, uv.y) + v * gainFor(asp));
  gl_FragColor = finish(col, p);
}`,

  /* Tall curtains of light hanging from the top, swaying slowly. */
  veil: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = u_time * 0.05;
  float x = p.x * 1.5 + 0.4 * fbm(vec2(p.y * 0.7 + t, t * 0.6));
  float curtain = fbm(vec2(x * 2.4, t * 0.5));
  curtain = pow(smoothstep(0.32, 0.82, curtain), 1.5);
  float hang = smoothstep(-0.75, 0.5, p.y);
  float light = voiceLight(vec2(p.x, p.y * 0.5 + 0.1), asp, t);
  float v = curtain * hang * (0.05 + 0.3 * light) + light * 0.05;
  v += smoothstep(-0.2, 0.55, p.y) * 0.02;
  vec3 col = vec3(mix(0.01, 0.03, uv.y) + v * gainFor(asp));
  gl_FragColor = finish(col, p);
}`,

  /* Topographic lines over a slowly shifting height field. */
  contour: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = u_time * 0.03;
  float h = fbm(p * 1.5 + vec2(t, -t * 0.7)) + 0.3 * fbm(p * 3.1 - t);
  float k = h * 11.0;
  float f = fract(k);
  float d = min(f, 1.0 - f);
#ifdef GL_OES_standard_derivatives
  // Hairlines of constant on-screen width, however steep the slope.
  float line = 1.0 - smoothstep(0.35, 1.35, d / max(fwidth(k), 1e-4));
#else
  float line = 1.0 - smoothstep(0.02, 0.07, d);
#endif
  float major = step(0.5, fract(k / 5.0 + 0.1)) * step(fract(k / 5.0 + 0.1), 0.7);
  float light = voiceLight(p, asp, t);
  float v = line * (0.022 + 0.2 * light) * (1.0 + 0.6 * major) + light * 0.05;
  vec3 col = vec3(mix(0.012, 0.032, uv.y) + v * gainFor(asp));
  gl_FragColor = finish(col, p);
}`,

  /* Near-black, a single wide fall of light, and film grain. */
  monolith: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = u_time * 0.04;
  vec2 src = vec2(0.18 * asp, 0.78);
  vec2 d = (p - src) * vec2(0.62, 0.95);
  float fall = exp(-dot(d, d) * 1.6);
  float light = voiceLight(p, asp, t);
  float v = fall * (0.11 + 0.06 * dot(u_w, vec3(0.333))) + light * 0.035;
  v += (hash(floor(gl_FragCoord.xy) + fract(u_time * 0.37)) - 0.5) * 0.018;
  vec3 col = vec3(mix(0.006, 0.02, uv.y) + v * gainFor(asp));
  gl_FragColor = finish(col, p);
}`,
};

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

function createRenderer(canvas: HTMLCanvasElement, preset: ShaderPreset): Renderer | null {
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
  const derivs = !!gl.getExtension("OES_standard_derivatives");
  const ext = derivs ? "#extension GL_OES_standard_derivatives : enable\n" : "";
  const fs = compile(gl, gl.FRAGMENT_SHADER, ext + COMMON + PRESETS[preset]);
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
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    },
  };
}

const thumbs = new Map<ShaderPreset, string | null>();

/** A still of a preset for the settings picker, rendered once and cached.
 *  The context is released right after, so it never counts against the
 *  browser's WebGL context limit. */
export function presetThumb(preset: ShaderPreset): string | null {
  if (thumbs.has(preset)) return thumbs.get(preset) ?? null;
  const canvas = document.createElement("canvas");
  const r = createRenderer(canvas, preset);
  let url: string | null = null;
  if (r) {
    r.resize(240, 150);
    const t = targets(["#fafafa", "#a4a4a4", "#787878"], 0);
    r.draw({ t: 3, rgb: t.rgb, w: t.w });
    url = canvas.toDataURL("image/jpeg", 0.85);
    r.dispose();
  }
  thumbs.set(preset, url);
  return url;
}

interface Props {
  /** Voice colors in slot order (2 or 3). */
  colors: string[];
  /** Index into `colors` of the voice that is speaking / up next, or -1. */
  focus: number;
  fx: FxLevel;
  /** Fixed for the component's life; remount (key) to switch. */
  preset: ShaderPreset;
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
function StageField({ colors, focus, fx, preset }: Props) {
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
    const ra = createRenderer(ca, preset);
    const rb = createRenderer(cb, preset);
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
    // The preset is fixed per mount (callers key on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
