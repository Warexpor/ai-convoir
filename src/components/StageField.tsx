import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_motion;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * u_motion;

  vec3 base = vec3(0.0784);

  float sky = smoothstep(1.08, 0.18, uv.y) * 0.03;

  vec2 s1 = p - vec2(-0.22 + sin(t * 0.09) * 0.07, 0.28 + cos(t * 0.07) * 0.04);
  s1 *= vec2(1.7, 2.8);
  float spec1 = exp(-dot(s1, s1) * 3.1) * 0.065;

  vec2 s2 = p - vec2(0.46 + cos(t * 0.06) * 0.05, -0.12 + sin(t * 0.08) * 0.05);
  s2 *= vec2(2.4, 1.55);
  float spec2 = exp(-dot(s2, s2) * 4.4) * 0.035;

  float band = abs(p.x * 0.22 + p.y * 0.97 - 0.06 - sin(t * 0.05) * 0.1);
  float streak = pow(1.0 - smoothstep(0.0, 0.16, band), 5.0) * 0.04;

  float grain = (noise(gl_FragCoord.xy * 0.72) - 0.5) * 0.022;
  float lift = sky + spec1 + spec2 + streak;
  vec3 col = base + vec3(lift) + grain;
  gl_FragColor = vec4(col, 1.0);
}
`;

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

export default function StageField() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl =
      canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "low-power",
      }) ||
      (canvas.getContext("experimental-webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
      }) as WebGLRenderingContext | null);
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uMotion = gl.getUniformLocation(prog, "u_motion");

    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const start = performance.now();

    const live = () => !document.hidden && !motionMq.matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.floor(wrap.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const draw = (now: number) => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) * 0.001);
      gl.uniform1f(uMotion, live() ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      draw(now);
      if (live()) raf = requestAnimationFrame(loop);
      else raf = 0;
    };

    const kick = () => {
      if (raf) return;
      raf = requestAnimationFrame(loop);
    };

    const onVis = () => {
      if (live()) kick();
      else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        draw(performance.now());
      }
    };
    const onMotion = () => onVis();

    const ro = new ResizeObserver(() => {
      if (!raf) draw(performance.now());
    });
    ro.observe(wrap);

    document.addEventListener("visibilitychange", onVis);
    motionMq.addEventListener("change", onMotion);
    kick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      motionMq.removeEventListener("change", onMotion);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <div className="stage" ref={wrapRef} aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}
