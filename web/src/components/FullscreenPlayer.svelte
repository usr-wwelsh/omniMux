<script lang="ts">
  import {
    currentTrack, isPlaying, currentTime, duration, volume,
    shuffle, loop, togglePlay, seek, seekOnActiveDevice, setVolume,
    playNext, playPrev, toggleShuffle, cycleLoop, formatTime,
    queue, activeDeviceId, localDeviceId, claimPlayback,
  } from '$lib/stores/player';
  import { otherDevices } from '$lib/stores/devices';
  import { showFullscreenPlayer, artModeActive, artExpandRequested, autoDJToast } from '$lib/stores/ui';
  import { autoDJActive, advanceVis, visCyclingPaused } from '$lib/stores/autodj';
  import { goto } from '$app/navigation';
  import QueuePanel from './QueuePanel.svelte';
  import {
    visMode, type VisMode, getAnalyser, resumeContext,
    fillFrequencyData, bassFromBuf, midFromBuf, overallFromBuf,
  } from '$lib/stores/visualizer';

  // ── WebGL visualizer ─────────────────────────────────────────────────────
  type ProgLocs = Record<string, WebGLUniformLocation | null>;
  interface GLState {
    gl: WebGL2RenderingContext;
    progs: Record<string, { prog: WebGLProgram; locs: ProgLocs }>;
    tex: WebGLTexture;
    vao: WebGLVertexArrayObject;
  }

  const _VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const _WARP_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uAmp;
in vec2 vUv;
out vec4 outColor;
void main() {
  float dx = sin(vUv.y * 12.566 + uTime) * uAmp;
  outColor = texture(uTex, vec2(clamp(vUv.x + dx, 0.0, 1.0), vUv.y));
}`;

  const _RIPPLE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uAmp;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 d = vUv - vec2(0.5);
  float dist = length(d);
  float envelope = max(0.0, 1.0 - dist / 0.7071);
  float displace = sin(dist * 16.0 - uTime * 2.0) * uAmp * envelope;
  vec2 dir = dist > 0.001 ? d / dist : vec2(0.0);
  outColor = texture(uTex, clamp(vUv + dir * displace, 0.0, 1.0));
}`;

  const _TUNNEL_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect * 1.4, 1.4);
  float a = atan(p.y, p.x) / 6.28318 + 0.5;
  float r = length(p);
  float depth = 0.35 / max(r, 0.001);
  float speed = 0.22 + uBass * 0.6;
  vec2 tuv = vec2(a, fract(depth - uTime * speed));
  float vignette = 1.0 - smoothstep(0.35, 1.1, r);
  outColor = texture(uTex, tuv) * vignette;
}`;

  const _FRACTAL_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
uniform float uMid;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 z = (vUv - 0.5) * 3.0;
  float a = uTime * 0.22;
  vec2 c = vec2(-0.7 + cos(a) * (0.15 + uBass * 0.25),
                 0.27 + sin(a * 0.7) * (0.1 + uMid * 0.2));
  const int MAX = 48;
  int iters = MAX;
  for (int i = 0; i < MAX; i++) {
    if (dot(z, z) > 4.0) { iters = i; break; }
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
  }
  if (iters == MAX) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t = float(iters) / float(MAX);
  outColor = texture(uTex, vec2(t, 0.5 + sin(t * 6.28318 + uTime * 0.4) * 0.45));
}`;

  const _KALEIDOSCOPE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x) + uTime * 0.12;
  float segs = 6.0 + floor(uBass * 6.0);
  float seg = 3.14159 / segs;
  a = mod(a, 2.0 * seg);
  if (a > seg) a = 2.0 * seg - a;
  vec2 uv = vec2(r * cos(a) + 0.5, r * sin(a) + 0.5);
  outColor = texture(uTex, fract(uv));
}`;

  const _DROSTE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uOverall;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  if (r < 0.001) { outColor = texture(uTex, vUv); return; }
  float a = atan(p.y, p.x) / 6.28318 + 0.5;
  float logR = (log(r) + 4.5) / 4.5;
  float scroll = uTime * 0.1 * (0.5 + uOverall * 0.5);
  float zoom = fract(logR * 1.5 - scroll);
  outColor = texture(uTex, vec2(a, zoom));
}`;

  const _VORTEX_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);
  float swirl = exp(-r * 2.5) * uTime * 0.5 * (1.0 + uBass * 4.0);
  a += swirl;
  vec2 uv = clamp(vec2(r * cos(a) + 0.5, r * sin(a) + 0.5), 0.0, 1.0);
  outColor = texture(uTex, uv);
}`;

  const _GLITCH_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
in vec2 vUv;
out vec4 outColor;
void main() {
  float scanline = floor(vUv.y * 80.0) / 80.0;
  float seed = floor(uTime * 6.0);
  float n = fract(sin(scanline * 127.1 + seed * 311.7) * 43758.5);
  float glitch = step(1.0 - max(uBass * 0.5, 0.05), n);
  float shift = (n * 2.0 - 1.0) * glitch * 0.07;
  float chrom = 0.008 * glitch;
  float r = texture(uTex, vec2(fract(vUv.x + shift + chrom), vUv.y)).r;
  float g = texture(uTex, vec2(fract(vUv.x + shift),         vUv.y)).g;
  float b = texture(uTex, vec2(fract(vUv.x + shift - chrom), vUv.y)).b;
  outColor = vec4(r, g, b, 1.0);
}`;

  const _CRYSTAL_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
in vec2 vUv;
out vec4 outColor;
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
void main() {
  float scale = 3.0 + uBass * 4.0;
  vec2 st  = vUv * scale;
  vec2 ist = floor(st);
  vec2 fst = fract(st);
  float md = 9.0;
  vec2 cc = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 nb = vec2(float(x), float(y));
      vec2 pt = hash22(ist + nb);
      pt = 0.5 + 0.5 * sin(uTime * 0.35 + 6.2831 * pt);
      vec2 d = nb + pt - fst;
      float dist = length(d);
      if (dist < md) { md = dist; cc = ist + nb + pt; }
    }
  }
  vec2 suv = clamp(cc / scale, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, 0.07, md);
  outColor = texture(uTex, suv) * (1.0 - edge * 0.85);
}`;

  const _AURORA_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uOverall;
in vec2 vUv;
out vec4 outColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i.x + i.y*57.0), hash(i.x+1.0 + i.y*57.0), f.x),
             mix(hash(i.x + (i.y+1.0)*57.0), hash(i.x+1.0 + (i.y+1.0)*57.0), f.x), f.y);
}
void main() {
  vec4 art = texture(uTex, vUv);
  float n1 = noise(vec2(vUv.x * 3.5 + uTime * 0.18, uTime * 0.07));
  float n2 = noise(vec2(vUv.x * 5.0 - uTime * 0.13, uTime * 0.04 + 1.7));
  float curtain = smoothstep(0.3, 0.85, n1) * smoothstep(0.25, 0.8, n2);
  vec3 c1 = vec3(0.0, 1.0, 0.45);
  vec3 c2 = vec3(0.1, 0.3, 1.0);
  vec3 c3 = vec3(0.9, 0.0, 0.9);
  vec3 aurora = mix(mix(c1, c2, n2), c3, n1 * 0.4);
  float intensity = curtain * (0.35 + uOverall * 0.65);
  outColor = vec4(art.rgb + aurora * intensity * 0.8, 1.0);
}`;

  const _PLASMA_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
uniform float uMid;
in vec2 vUv;
out vec4 outColor;
void main() {
  float t = uTime * 0.5;
  vec2 uv = vUv * 2.5;
  float v = sin(uv.x * (2.0 + uMid*1.5) + t)
          + sin(uv.y * (2.0 + uBass*1.5) + t*0.9)
          + sin((uv.x + uv.y)*2.0 + t*1.2)
          + sin(length(uv - vec2(1.25))*(3.0 + uMid*3.0) - t*1.4);
  float hue = v * 0.125 + 0.5;
  vec3 c = 0.5 + 0.5*cos(6.28318*(hue + vec3(0.0, 0.333, 0.667)));
  vec4 art = texture(uTex, vUv);
  outColor = vec4(mix(art.rgb, c, 0.4 + uBass * 0.3), 1.0);
}`;

  const _SPHERE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uTime;
uniform float uBass;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect * 2.0, 2.0);
  vec3 ro = vec3(0.0, 0.0, 2.8);
  vec3 rd = normalize(vec3(p, -2.0));
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b*b - c;
  if (h < 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t = -b - sqrt(h);
  vec3 hit = ro + rd * t;
  float rot = uTime * 0.1 * (1.0 + uBass * 0.5);
  float cr = cos(rot), sr = sin(rot);
  vec3 rh = vec3(hit.x*cr - hit.z*sr, hit.y, hit.x*sr + hit.z*cr);
  float phi   = atan(rh.z, rh.x) / 6.28318 + 0.5;
  float theta = acos(clamp(rh.y, -1.0, 1.0)) / 3.14159;
  vec4 col = texture(uTex, vec2(phi, theta));
  vec3 light = normalize(vec3(1.2, 0.8, 0.5));
  float diff = max(dot(hit, light), 0.0);
  float spec = pow(max(dot(reflect(-light, hit), normalize(ro)), 0.0), 24.0);
  outColor = col * (0.2 + 0.8*diff) + vec4(vec3(spec * 0.25), 0.0);
}`;

  function initWebGL(canvas: HTMLCanvasElement): GLState | null {
    const glNullable = canvas.getContext('webgl2');
    if (!glNullable) return null;
    const gl = glNullable;
    function compile(type: number, src: string): WebGLShader {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    }
    function makeProgram(vs: string, fs: string): WebGLProgram {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      return prog;
    }
    function getUniformLocs(prog: WebGLProgram): ProgLocs {
      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
      const locs: ProgLocs = {};
      for (const n of ['uTime','uBass','uMid','uOverall','uAmp','uAspect']) {
        locs[n] = gl.getUniformLocation(prog, n);
      }
      return locs;
    }
    const shaderSrcs: Record<string, string> = {
      warp: _WARP_FS, ripple: _RIPPLE_FS,
      tunnel: _TUNNEL_FS, fractal: _FRACTAL_FS, kaleidoscope: _KALEIDOSCOPE_FS,
      droste: _DROSTE_FS, vortex: _VORTEX_FS, glitch: _GLITCH_FS,
      crystal: _CRYSTAL_FS, aurora: _AURORA_FS, plasma: _PLASMA_FS, sphere: _SPHERE_FS,
    };
    const progs: GLState['progs'] = {};
    for (const [name, fs] of Object.entries(shaderSrcs)) {
      const prog = makeProgram(_VS, fs);
      progs[name] = { prog, locs: getUniformLocs(prog) };
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255]));
    return { gl, progs, tex, vao };
  }

  function uploadTexture(gs: GLState, bitmap: ImageBitmap): void {
    const { gl, tex } = gs;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  }

  function drawGL(mode: string): void {
    if (!glState || !freqBuf) return;
    const { gl, progs, tex, vao } = glState;
    const entry = progs[mode];
    if (!entry) return;
    const { prog, locs } = entry;
    const t    = performance.now() * 0.001;
    const bass = bassFromBuf(freqBuf);
    const mid  = midFromBuf(freqBuf);
    const overall = overallFromBuf(freqBuf);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const set = (n: string, v: number) => { const l = locs[n]; if (l != null) gl.uniform1f(l, v); };
    set('uTime',    t);
    set('uBass',    bass);
    set('uMid',     mid);
    set('uOverall', overall);
    set('uAspect',  gl.drawingBufferWidth / gl.drawingBufferHeight);
    // Legacy amp uniforms for warp/ripple shaders
    if (mode === 'warp')   set('uAmp', (mid * 30) / gl.drawingBufferWidth);
    if (mode === 'ripple') set('uAmp', (overall * 18) / gl.drawingBufferWidth);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  let tab = $state<'playing' | 'queue'>('playing');

  const isActivePlayer = $derived(!$activeDeviceId || $activeDeviceId === $localDeviceId);
  const activeDeviceName = $derived(
    $otherDevices.find((d) => d.device_id === $activeDeviceId)?.device_name ?? 'another device'
  );

  let progressBar: HTMLDivElement;
  let volumeBar: HTMLDivElement;

  let progress = $derived($duration > 0 ? ($currentTime / $duration) * 100 : 0);

  function handleProgressClick(e: MouseEvent) {
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (isActivePlayer) {
      seek(pct * $duration);
    } else {
      seekOnActiveDevice(pct * $duration);
    }
  }

  function handleVolumeClick(e: MouseEvent) {
    if (!volumeBar) return;
    const rect = volumeBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
  }

  function close() {
    showFullscreenPlayer.set(false);
  }

  // Swipe down to close
  let touchStartY = 0;
  function onTouchStart(e: TouchEvent) {
    touchStartY = e.touches[0].clientY;
  }
  function onTouchEnd(e: TouchEvent) {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80) close();
  }

  let artExpanded = $state(false);

  const VIS_MODES: VisMode[] = ['off', 'pan', 'pulse', 'warp', 'ripple', 'tunnel', 'fractal', 'kaleidoscope', 'droste', 'vortex', 'glitch', 'crystal', 'aurora', 'plasma', 'sphere'];
  const CANVAS_MODES = new Set<VisMode>(['warp', 'ripple', 'tunnel', 'fractal', 'kaleidoscope', 'droste', 'vortex', 'glitch', 'crystal', 'aurora', 'plasma', 'sphere']);

  // Visualizer state
  let visCanvas: HTMLCanvasElement | undefined = $state();
  let artImg: HTMLImageElement | undefined = $state();
  let imgNaturalW = $state(0);
  let imgNaturalH = $state(0);
  let rafId: number | null = null;
  let freqBuf: Uint8Array<ArrayBuffer> | null = null;
  let imgBitmap: ImageBitmap | null = null;
  let glState: GLState | null = null;

  // Auto-hide controls in art-mode after 2s of no mouse/touch movement
  let controlsVisible = $state(true);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function showControls() {
    controlsVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    if (artExpanded) {
      hideTimer = setTimeout(() => { controlsVisible = false; }, 2000);
    }
  }

  $effect(() => {
    if (artExpanded) {
      showControls();
    } else {
      controlsVisible = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }
  });

  $effect(() => { artModeActive.set(artExpanded); });

  // Tick currentTime forward every 250ms when watching another device play,
  // so the progress bar advances smoothly between 1s device polls.
  $effect(() => {
    if (isActivePlayer) return; // active device drives its own timeupdate events
    const interval = setInterval(() => {
      if ($isPlaying) return; // active device is paused on this device too
      // Advance if another device is playing
      const activeSession = $otherDevices.find((d) => d.device_id === $activeDeviceId);
      if (activeSession?.is_playing) {
        currentTime.update((t) => Math.min(t + 0.25, $duration || Infinity));
      }
    }, 250);
    return () => clearInterval(interval);
  });

  // Persists the last successfully loaded art URL so old art shows while new art loads
  let displayedCoverUrl = $state<string | undefined>(undefined);

  $effect(() => {
    const src = $currentTrack?.hqCoverUrl ?? $currentTrack?.coverUrl;
    if (!src) return;
    const img = new Image();
    img.onload = () => { displayedCoverUrl = src; };
    img.src = src;
  });

  const hasArt = $derived(!!displayedCoverUrl);
  const isCanvasMode = $derived(CANVAS_MODES.has($visMode));

  // React to external requests to enter art mode (e.g. from Auto DJ toggle)
  $effect(() => {
    if ($artExpandRequested > 0 && hasArt) expandArt();
  });

  // Pan direction: horizontal if art is wider relative to viewport than viewport itself
  const panHorizontal = $derived(
    imgNaturalW > 0 && imgNaturalH > 0 &&
    (imgNaturalW / imgNaturalH) > (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1)
  );

  // Load natural dimensions for pan direction detection
  $effect(() => {
    const src = displayedCoverUrl;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      imgNaturalW = img.naturalWidth;
      imgNaturalH = img.naturalHeight;
    };
    img.src = src;
  });

  // Create ImageBitmap for canvas-based visualizers
  $effect(() => {
    const src = displayedCoverUrl;
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      createImageBitmap(img).then((bm) => {
        if (!alive) { bm.close(); return; }
        imgBitmap?.close();
        imgBitmap = bm;
        if (glState) uploadTexture(glState, bm);
      }).catch(() => {
        // CORS or decode failure — canvas modes will render nothing gracefully
        imgBitmap?.close();
        imgBitmap = null;
      });
    };
    img.src = src;
    return () => { alive = false; };
  });

  // Canvas sizing (quarter-resolution — WebGL bilinear upscaling via CSS) + GL init/teardown
  $effect(() => {
    if (!visCanvas) { glState = null; return; }
    function resize() {
      if (!visCanvas) return;
      visCanvas.width = Math.round(window.innerWidth / 4);
      visCanvas.height = Math.round(window.innerHeight / 4);
    }
    resize();
    window.addEventListener('resize', resize);
    glState = initWebGL(visCanvas);
    if (glState && imgBitmap) uploadTexture(glState, imgBitmap);
    return () => {
      window.removeEventListener('resize', resize);
      glState = null;
    };
  });

  // RAF lifecycle — start/stop based on artExpanded and visMode
  $effect(() => {
    const mode = $visMode;
    if (!artExpanded || mode === 'off' || mode === 'pan') {
      stopRaf();
      // Reset pulse scale when leaving pulse mode
      if (artImg) artImg.style.transform = '';
      return;
    }
    resumeContext();
    const analyser = getAnalyser();
    if (!analyser) return;
    if (!freqBuf) freqBuf = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    startRaf(mode, analyser);
    return () => {
      stopRaf();
      if (artImg) artImg.style.transform = '';
    };
  });

  function stopRaf() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function startRaf(mode: VisMode, analyser: AnalyserNode) {
    stopRaf();
    const FRAME_MS = 1000 / 30; // cap at 30fps
    let lastFrame = 0;
    function frame(now: number) {
      rafId = requestAnimationFrame(frame);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      fillFrequencyData(analyser, freqBuf!);
      if (mode === 'pulse') drawPulse();
      else drawGL(mode);
    }
    rafId = requestAnimationFrame(frame);
  }

  function drawPulse() {
    if (!artImg) return;
    const bass = bassFromBuf(freqBuf!);
    const scale = 1 + bass * 0.1;
    artImg.style.transform = `scale(${scale.toFixed(4)})`;
    artImg.style.transition = 'none';
  }


  function expandArt() {
    if (!hasArt) return;
    artExpanded = true;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function collapseArt() {
    artExpanded = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // Sync artExpanded when browser exits fullscreen via Esc or other means
  $effect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement && artExpanded) artExpanded = false;
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  });

  // Esc key exits art mode
  $effect(() => {
    if (!artExpanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') collapseArt();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fs-overlay"
  class:art-mode={artExpanded}
  class:ui-hidden={artExpanded && !controlsVisible}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
  onmousemove={showControls}
  ontouchmove={showControls}
>

  <!-- Full-screen art background (art-mode only) — clicking it collapses -->
  {#if artExpanded && displayedCoverUrl}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="fs-art-bg-wrap" onclick={collapseArt}>
      <img
        class="fs-art-bg"
        class:vis-pan={$visMode === 'pan'}
        class:vis-pan-h={$visMode === 'pan' && panHorizontal}
        class:vis-pan-v={$visMode === 'pan' && !panHorizontal}
        class:vis-hidden={isCanvasMode}
        src={displayedCoverUrl}
        alt=""
        bind:this={artImg}
      />
      {#if isCanvasMode}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <canvas class="fs-vis-canvas" bind:this={visCanvas}></canvas>
      {/if}
    </div>
  {/if}

  <!-- Header -->
  <div class="fs-header">
    <button class="fs-close" onclick={close}>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
    </button>
    {#if !artExpanded}
    <div class="fs-tabs">
      <button class="fs-tab" class:active={tab === 'playing'} onclick={() => tab = 'playing'}>Now Playing</button>
      <button class="fs-tab" class:active={tab === 'queue'} onclick={() => tab = 'queue'}>Queue {#if $queue.length > 0}<span class="fs-tab-count">{$queue.length}</span>{/if}</button>
    </div>
    {:else}
    <div style="width: 0"></div>
    {/if}
    {#if artExpanded}
      <div class="fs-header-right">
        {#if $autoDJActive}
          <div class="autodj-badge">AUTO DJ</div>
        {/if}
        <!-- Collapse art button in art-mode -->
        <button class="fs-collapse-art" onclick={collapseArt} title="Exit art view">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
        </button>
      </div>
    {:else}
      <div style="width: 36px"></div>
    {/if}
  </div>

  {#if $currentTrack}
  <div class="fs-body">

    <!-- Player panel (hidden on mobile when queue tab active) -->
    <div class="fs-player-panel" class:mobile-hidden={tab === 'queue'}>

      <!-- Album art square (hidden in art-mode — art is the background instead) -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="fs-art-wrap" class:has-art={hasArt} onclick={expandArt}>
        {#if displayedCoverUrl}
          <img src={displayedCoverUrl} alt="" class="fs-art" />
        {:else}
          <div class="fs-art placeholder">
            <svg viewBox="0 0 24 24" width="80" height="80" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
        {/if}
      </div>

      <!-- Visualizer mode picker (art-mode only) -->
      {#if artExpanded}
        <div class="vis-mode-picker">
          {#each VIS_MODES as m}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <button
              class="vis-mode-btn"
              class:active={$visMode === m}
              onclick={(e) => { e.stopPropagation(); visMode.set(m); }}
            >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
          {/each}
          <!-- Cycling toggle — pauses/resumes auto-vis-cycling, disabled when vis is off -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <button
            class="vis-mode-btn vis-cycle-toggle"
            class:cycling-on={!$visCyclingPaused && $visMode !== 'off'}
            disabled={$visMode === 'off'}
            onclick={(e) => { e.stopPropagation(); visCyclingPaused.update((v) => !v); }}
            title={$visCyclingPaused ? 'Resume vis cycling' : 'Pause vis cycling'}
          >
            <span class="vis-cycle-pill">
              <span class="vis-cycle-knob"></span>
            </span>
            Cycle
          </button>
        </div>
      {/if}

      <!-- Track info -->
      <div class="fs-info">
        <div class="fs-title">{$currentTrack.title}</div>
        {#if $currentTrack.artistId}
          <button class="fs-artist fs-artist--link" onclick={() => { close(); goto(`/library/artist/${$currentTrack!.artistId}`); }}>
            {$currentTrack.artist}
          </button>
        {:else}
          <div class="fs-artist">{$currentTrack.artist}</div>
        {/if}
        {#if !isActivePlayer}
          <div class="fs-ownership">
            <span>Playing on <strong>{activeDeviceName}</strong></span>
            <button class="fs-play-here-btn" onclick={claimPlayback}>Play here</button>
          </div>
        {/if}
      </div>

      <!-- Progress -->
      <div class="fs-progress-section">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="fs-progress-bar"
          bind:this={progressBar}
          onclick={handleProgressClick}
        >
          <div class="fs-progress-fill" style="width: {progress}%">
            <div class="fs-progress-thumb"></div>
          </div>
        </div>
        <div class="fs-times">
          <span>{formatTime($currentTime)}</span>
          <span>{formatTime($duration)}</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="fs-controls">
        <button class="fs-mode-btn" class:active={$shuffle} onclick={toggleShuffle} title="Shuffle">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button class="fs-btn" onclick={playPrev}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="fs-play-btn" onclick={togglePlay}>
          {#if $isPlaying}
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </button>
        <button class="fs-btn" onclick={playNext}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button class="fs-mode-btn" class:active={$loop !== 'none'} onclick={cycleLoop}>
          {#if $loop === 'one'}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          {/if}
        </button>
      </div>

      <!-- Volume -->
      <div class="fs-volume">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="fs-vol-icon"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/><path d="M5 9v6h4l5 5V4L9 9H5zm7-.17v6.34L9.83 13H7v-2h2.83L12 8.83z"/></svg>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fs-vol-bar" bind:this={volumeBar} onclick={handleVolumeClick}>
          <div class="fs-vol-fill" style="width: {$volume * 100}%"></div>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="fs-vol-icon"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
      </div>

    </div>

    <!-- Queue panel (hidden on mobile when playing tab active; always hidden in art-mode) -->
    <div class="fs-queue-panel" class:mobile-hidden={tab === 'playing'}>
      <QueuePanel />
    </div>

  </div>
  {/if}

  {#if $autoDJToast}
    <div class="autodj-toast">{$autoDJToast}</div>
  {/if}

</div>

<style>
  .fs-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* ── Art-mode: fullscreen background ── */
  .fs-overlay.art-mode {
    overflow: hidden;
    background: #000;
  }

  .fs-art-bg-wrap {
    position: absolute;
    inset: 0;
    z-index: 0;
    cursor: zoom-out;
    overflow: hidden;
  }

  .fs-art-bg {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* Pan (Ken Burns) mode */
  .fs-art-bg.vis-pan {
    object-fit: unset;
    position: absolute;
  }

  .fs-art-bg.vis-pan-h {
    height: 100%;
    width: auto;
    min-width: unset;
    top: 0;
    left: 0;
    animation: pan-h 25s ease-in-out infinite alternate;
  }

  .fs-art-bg.vis-pan-v {
    width: 100%;
    height: auto;
    min-height: unset;
    top: 0;
    left: 0;
    animation: pan-v 25s ease-in-out infinite alternate;
  }

  @keyframes pan-h {
    from { transform: translateX(0); }
    to   { transform: translateX(calc(-100% + 100vw)); }
  }

  @keyframes pan-v {
    from { transform: translateY(0); }
    to   { transform: translateY(calc(-100% + 100vh)); }
  }

  /* Hide image when canvas visualizer is active */
  .fs-art-bg.vis-hidden {
    display: none;
  }

  /* Canvas overlay for warp/ripple */
  .fs-vis-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    display: block;
  }

  /* Visualizer mode picker */
  .vis-mode-picker {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .vis-mode-btn {
    padding: 5px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: background 0.15s, color 0.15s;
    cursor: pointer;
  }

  .vis-mode-btn:hover {
    color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.18);
  }

  .vis-mode-btn.active {
    color: #fff;
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.4);
  }

  .vis-cycle-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vis-cycle-toggle:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .vis-cycle-pill {
    width: 26px;
    height: 14px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    padding: 2px;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .vis-cycle-knob {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    transition: transform 0.2s, background 0.2s;
  }

  .vis-cycle-toggle.cycling-on .vis-cycle-pill {
    background: var(--accent, rgba(255,255,255,0.5));
  }

  .vis-cycle-toggle.cycling-on .vis-cycle-knob {
    transform: translateX(12px);
    background: #fff;
  }

  /* Raise header and body above the art background */
  .art-mode .fs-header,
  .art-mode .fs-body {
    position: relative;
    z-index: 1;
  }

  /* Auto-hide controls in art-mode */
  .art-mode .fs-header,
  .art-mode .fs-player-panel {
    transition: opacity 0.5s ease;
  }

  .art-mode.ui-hidden .fs-header,
  .art-mode.ui-hidden .fs-player-panel {
    opacity: 0;
    pointer-events: none;
  }

  /* Header in art-mode: transparent, white text */
  .art-mode .fs-header {
    background: transparent;
  }

  .art-mode .fs-close,
  .art-mode .fs-collapse-art {
    color: rgba(255, 255, 255, 0.85);
  }

  /* Body in art-mode: fill remaining space, push controls to bottom */
  .art-mode .fs-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  /* Art square hidden in art-mode */
  .art-mode .fs-art-wrap {
    display: none;
  }

  /* Queue hidden in art-mode */
  .art-mode .fs-queue-panel {
    display: none !important;
  }

  /* Player panel fills full width, anchors to bottom, gradient overlay */
  .art-mode .fs-player-panel {
    flex: 1 !important;
    width: 100% !important;
    max-width: none !important;
    justify-content: flex-end !important;
    padding: 0 48px 48px !important;
    background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
  }

  /* Override art-mode colors for all text/controls */
  .art-mode .fs-title { color: #fff; }
  .art-mode .fs-artist { color: rgba(255, 255, 255, 0.7); }
  .art-mode .fs-times { color: rgba(255, 255, 255, 0.5); }
  .art-mode .fs-progress-bar { background: rgba(255, 255, 255, 0.2); }
  .art-mode .fs-progress-fill { background: rgba(255, 255, 255, 0.9); }
  .art-mode .fs-progress-thumb { background: #fff; }
  .art-mode .fs-btn { color: #fff; }
  .art-mode .fs-play-btn { background: rgba(255, 255, 255, 0.95); color: #000; }
  .art-mode .fs-mode-btn { color: rgba(255, 255, 255, 0.45); }
  .art-mode .fs-mode-btn.active { color: var(--accent); }
  .art-mode .fs-vol-icon { color: rgba(255, 255, 255, 0.45); }
  .art-mode .fs-vol-bar { background: rgba(255, 255, 255, 0.2); }
  .art-mode .fs-vol-fill { background: rgba(255, 255, 255, 0.65); }
  .art-mode .fs-volume { display: flex !important; }

  /* ── Normal mode styles ── */

  .fs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 8px;
    flex-shrink: 0;
  }

  .fs-tabs {
    display: flex;
    background: var(--bg-elevated);
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
  }

  .fs-tab {
    padding: 7px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }

  .fs-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .fs-tab-count {
    font-size: 11px;
    font-weight: 700;
    background: var(--accent);
    color: #000;
    border-radius: 10px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .fs-close {
    color: var(--text-secondary);
    display: flex;
    padding: 4px;
    transition: color 0.15s;
  }

  .fs-close:hover {
    color: var(--text-primary);
  }

  .fs-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .autodj-badge {
    padding: 3px 10px;
    border-radius: 12px;
    background: var(--accent);
    color: #000;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .fs-collapse-art {
    color: var(--text-secondary);
    display: flex;
    padding: 4px;
    transition: color 0.15s;
  }

  .fs-collapse-art:hover {
    color: var(--text-primary);
  }

  .fs-body {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
  }

  .fs-player-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 0 40px 40px;
    width: 100%;
  }

  .fs-queue-panel {
    overflow-y: auto;
    width: 100%;
  }

  .mobile-hidden {
    display: none;
  }

  .fs-art-wrap {
    width: 100%;
    max-width: 380px;
  }

  .fs-art-wrap.has-art {
    cursor: zoom-in;
  }

  .fs-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 12px;
    object-fit: cover;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .fs-art-wrap.has-art:hover .fs-art {
    transform: scale(1.02);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
  }

  .fs-art.placeholder {
    aspect-ratio: 1;
    background: var(--bg-elevated);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fs-info {
    text-align: center;
    width: 100%;
  }

  .fs-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fs-artist {
    font-size: 16px;
    color: var(--text-secondary);
  }

  .fs-ownership {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .fs-ownership strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .fs-play-here-btn {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    padding: 4px 12px;
    border: 1px solid var(--accent);
    border-radius: 20px;
    transition: background 0.15s;
  }

  .fs-play-here-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .fs-artist--link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s;
  }

  .fs-artist--link:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .fs-progress-section {
    width: 100%;
  }

  .fs-progress-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-highlight);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
    margin-bottom: 8px;
  }

  .fs-progress-bar:hover {
    height: 6px;
    margin-top: -1px;
  }

  .fs-progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    position: relative;
  }

  .fs-progress-thumb {
    position: absolute;
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-primary);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .fs-progress-bar:hover .fs-progress-thumb {
    opacity: 1;
  }

  .fs-times {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-subdued);
  }

  .fs-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    width: 100%;
  }

  .fs-btn {
    color: var(--text-primary);
    display: flex;
    transition: opacity 0.15s;
  }

  .fs-btn:hover {
    opacity: 0.7;
  }

  .fs-play-btn {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--text-primary);
    color: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s;
    flex-shrink: 0;
  }

  .fs-play-btn:hover {
    transform: scale(1.04);
  }

  .fs-mode-btn {
    color: var(--text-subdued);
    display: flex;
    transition: color 0.15s;
  }

  .fs-mode-btn:hover, .fs-mode-btn.active {
    color: var(--accent);
  }

  .fs-volume {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .fs-vol-icon {
    color: var(--text-subdued);
    flex-shrink: 0;
  }

  .fs-vol-bar {
    flex: 1;
    height: 4px;
    background: var(--bg-highlight);
    border-radius: 2px;
    cursor: pointer;
  }

  .fs-vol-fill {
    height: 100%;
    background: var(--text-secondary);
    border-radius: 2px;
  }

  /* Desktop: side-by-side layout, tabs hidden */
  @media (min-width: 900px) {
    .fs-tabs {
      display: none;
    }

    .fs-header {
      justify-content: flex-start;
      gap: 0;
    }

    /* In art-mode on desktop, header stays space-between for the collapse button */
    .art-mode .fs-header {
      justify-content: space-between;
    }

    .fs-body {
      overflow: hidden;
    }

    .fs-player-panel {
      flex: 0 0 480px;
      justify-content: center;
      padding: 0 48px 48px;
    }

    .fs-player-panel.mobile-hidden,
    .fs-queue-panel.mobile-hidden {
      display: flex;
    }

    .fs-queue-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--bg-elevated);
      padding: 16px 0 0;
    }
  }

  /* Mobile: tab-controlled single panel, volume hidden */
  @media (max-width: 899px) {
    .fs-body {
      flex-direction: column;
    }

    .fs-player-panel {
      padding: 0 24px 32px;
      gap: 20px;
    }

    .fs-volume {
      display: none;
    }

    .art-mode .fs-player-panel {
      padding: 0 24px 40px !important;
    }
  }

  .autodj-toast {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(220, 60, 60, 0.92);
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    z-index: 10;
    pointer-events: none;
    white-space: nowrap;
  }

</style>
