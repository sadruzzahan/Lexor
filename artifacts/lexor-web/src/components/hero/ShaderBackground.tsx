import { Canvas, useFrame } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useReducedMotionPref, usePageVisible } from "@/lib/hooks";

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

class WebGLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* swallow — fallback gradient is shown */
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function StaticGradient() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(60% 50% at 60% 40%, color-mix(in oklch, var(--color-accent) 18%, transparent), transparent 70%), linear-gradient(180deg, var(--color-bg), var(--color-bg-elevated))",
      }}
    />
  );
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uRes;

  // base palette (approx oklch tokens converted to linear-ish RGB for the shader)
  const vec3 cBg     = vec3(0.043, 0.052, 0.072);   // near-black cool
  const vec3 cBg2    = vec3(0.068, 0.082, 0.110);   // elevated
  const vec3 cAccent = vec3(0.255, 0.690, 0.420);   // electric mint
  const vec3 cWarm   = vec3(0.110, 0.090, 0.140);

  // value noise
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(in vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0,0.0));
    float c = hash(i + vec2(0.0,1.0));
    float d = hash(i + vec2(1.0,1.0));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
    float t = uTime * 0.04;

    // slow drifting domain
    vec2 q = p * 1.6 + vec2(t * 0.7, t * 0.5);
    float n1 = fbm(q);
    float n2 = fbm(q + vec2(n1 * 1.4, -t));
    float n3 = fbm(q + n2 * 1.8 + vec2(-t * 0.8, t * 0.3));

    // gradient base from bg → bg2
    vec3 col = mix(cBg, cBg2, smoothstep(0.0, 1.0, uv.y * 0.9 + 0.05));
    col = mix(col, cWarm, n2 * 0.35);

    // a single drifting accent highlight
    vec2 ac = vec2(
      0.55 + 0.25 * sin(t * 1.3),
      0.40 + 0.18 * cos(t * 0.9 + 1.2)
    );
    float d = distance(p, ac * vec2(uRes.x / uRes.y, 1.0));
    float glow = exp(-d * 4.5) * (0.55 + 0.45 * n3);
    col += cAccent * glow * 0.55;

    // subtle vignette
    float vign = smoothstep(1.25, 0.55, length(uv - 0.5));
    col *= mix(0.78, 1.0, vign);

    // tiny grain
    col += (hash(uv * uRes + t) - 0.5) * 0.012;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function ShaderPlane() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const visible = usePageVisible();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  );

  useFrame(({ clock, size }) => {
    if (!matRef.current) return;
    if (!visible) return;
    matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    matRef.current.uniforms.uRes.value.set(size.width, size.height);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export function ShaderBackground() {
  const reduced = useReducedMotionPref();
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  if (reduced || webglOk === false) return <StaticGradient />;
  if (webglOk === null) return <StaticGradient />;

  return (
    <WebGLBoundary fallback={<StaticGradient />}>
      <div aria-hidden className="absolute inset-0">
        <Canvas
          gl={{ antialias: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: false }}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 1] }}
          style={{ display: "block" }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color("#0a0d14"), 1);
          }}
        >
          <ShaderPlane />
        </Canvas>
      </div>
    </WebGLBoundary>
  );
}
