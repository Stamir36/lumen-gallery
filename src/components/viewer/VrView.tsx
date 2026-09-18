import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/* 180° equirect projection of ONE stereo half (SBS): longitude in
   [-90°, +90°] maps to the u-range of that half, latitude to full v.
   Everything behind the viewer renders as the dark canvas void. */
const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
uniform float u_aspect;
uniform float u_half;
const float PI = 3.14159265;
void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  float tf = tan(u_fov * 0.5);
  vec3 dir = normalize(vec3(ndc.x * tf * u_aspect, ndc.y * tf, -1.0));
  float cp = cos(u_pitch);
  float sp = sin(u_pitch);
  dir = normalize(vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp));
  float cy = cos(u_yaw);
  float sy = sin(u_yaw);
  dir = normalize(vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy));
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  if (abs(lon) > PI * 0.5) {
    gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0);
    return;
  }
  float u = 0.25 + 0.5 * u_half + (lon / PI) * 0.5;
  float v = 0.5 - lat / PI;
  gl_FragColor = vec4(texture2D(u_tex, vec2(u, v)).rgb, 1.0);
}`;

const FOV_START = (80 * Math.PI) / 180;
const FOV_MIN = (35 * Math.PI) / 180;
const FOV_MAX = (110 * Math.PI) / 180;

/**
 * Immersion mode for SBS 180° video: one stereo half is projected as a MONO
 * 180° panorama (normal viewing, not stereoscopic). Raw WebGL — no new
 * dependency. The <video> element keeps playing (audio + decode run outside
 * this canvas); frames upload as a texture when the playback time changes.
 * Drag = look around (grab-the-world), wheel = fov.
 */
export function VrView({
  videoRef,
  eye,
  onFatal,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 0 = left half of the stereo pair, 1 = right half */
  eye: 0 | 1;
  /** called ONCE when the canvas can no longer take frames (tainted source) */
  onFatal?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const look = useRef({ yaw: 0, pitch: 0, fov: FOV_START });
  const last = useRef<{ x: number; y: number } | null>(null);
  /** uniform reads the ref — toggling the eye never rebuilds the GL context */
  const eyeRef = useRef(eye);
  eyeRef.current = eye;
  /** the draw loop must die on the first SecurityError, not spam every frame */
  const onFatalRef = useRef(onFatal);
  onFatalRef.current = onFatal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      console.error("vr: WebGL unavailable");
      return;
    }

    const compile = (type: number, source: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("vr shader", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("vr link", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // NPOT video frames: clamp + linear, no mipmaps
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const uYaw = gl.getUniformLocation(prog, "u_yaw");
    const uPitch = gl.getUniformLocation(prog, "u_pitch");
    const uFov = gl.getUniformLocation(prog, "u_fov");
    const uAspect = gl.getUniformLocation(prog, "u_aspect");
    const uHalf = gl.getUniformLocation(prog, "u_half");
    gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);

    // 8K SBS frames can exceed the GPU texture limit — an over-limit
    // texImage2D fails SILENTLY (GL error) and sampling an incomplete
    // texture gives a black canvas. Cap through a 2D downscale canvas.
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const stageCanvas = document.createElement("canvas");
    const stageCtx = stageCanvas.getContext("2d");
    let uploadsChecked = 0;
    const checkUpload = () => {
      if (uploadsChecked > 10) return;
      uploadsChecked++;
      const err = gl.getError();
      if (err !== gl.NO_ERROR) {
        console.error("vr: texture upload failed, GL error", err, "max", maxSize);
      }
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      look.current.fov = Math.min(
        FOV_MAX,
        Math.max(FOV_MIN, look.current.fov * Math.exp(e.deltaY * 0.0012)),
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    let lastTime = -1;
    let dead = false;
    const draw = () => {
      if (dead) return;
      raf = requestAnimationFrame(draw);
      const vid = videoRef.current;
      if (!vid || vid.readyState < 2 || !vid.videoWidth) return;
      resize();
      // upload a frame only when the playback time moved (seek/loop included)
      if (vid.currentTime !== lastTime) {
        lastTime = vid.currentTime;
        try {
          if (vid.videoWidth > maxSize || vid.videoHeight > maxSize) {
            // over-limit source: downscale through a 2D canvas first
            const scale = Math.min(
              maxSize / vid.videoWidth,
              maxSize / vid.videoHeight,
              1,
            );
            const w = Math.max(2, Math.round(vid.videoWidth * scale));
            const h = Math.max(2, Math.round(vid.videoHeight * scale));
            if (stageCanvas.width !== w || stageCanvas.height !== h) {
              stageCanvas.width = w;
              stageCanvas.height = h;
            }
            stageCtx?.drawImage(vid, 0, 0, w, h);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              stageCanvas,
            );
          } else {
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              vid,
            );
          }
          checkUpload();
        } catch (err) {
          // SecurityError = tainted frame (a non-CORS source slipped through).
          // Stop the loop ONCE and hand control back to the player — never a
          // console-per-frame storm.
          dead = true;
          cancelAnimationFrame(raf);
          console.error("vr: frame rejected, leaving the dome", err);
          onFatalRef.current?.();
          return;
        }
      }
      gl.uniform1f(uYaw, look.current.yaw);
      gl.uniform1f(uPitch, look.current.pitch);
      gl.uniform1f(uFov, look.current.fov);
      gl.uniform1f(uAspect, canvas.width / canvas.height);
      gl.uniform1f(uHalf, eyeRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [videoRef]);

  // grab-the-world: drag right moves the world right (camera turns left)
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const l = last.current;
    if (!l) return;
    const h = e.currentTarget.clientHeight || 1;
    const k = look.current.fov / h;
    look.current.yaw += (e.clientX - l.x) * k;
    look.current.pitch = Math.max(
      -1.55,
      Math.min(1.55, look.current.pitch + (e.clientY - l.y) * k),
    );
    l.x = e.clientX;
    l.y = e.clientY;
  };
  const endDrag = () => {
    last.current = null;
  };
  /** double-click re-centres the dome (and must NOT toggle fullscreen) */
  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    look.current.yaw = 0;
    look.current.pitch = 0;
    look.current.fov = FOV_START;
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 h-full w-full cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    />
  );
}