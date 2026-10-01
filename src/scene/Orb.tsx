import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'

/**
 * ODIN's presence: a sphere of dots that folds and ripples like cloth in a
 * slow current, pink at the crown fading through violet to blue underneath.
 *
 * Thousands of points on a Fibonacci sphere, each pushed along its normal by
 * layered simplex noise plus a couple of travelling folds — the folds are what
 * give it those ribbon-like creases instead of a uniformly lumpy ball. Dots on
 * the far side are dimmed so the sphere reads as a hollow shell, and dots on a
 * crest are brightened so the creases catch the light.
 *
 * It reads the same Drive object as everything else: louder voice → deeper
 * folds and faster flow; the phase colour tints the crown so listening,
 * thinking and speaking still look different at a glance.
 */

const COUNT = 9000

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uAmp;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vFacing;
  varying float vCrest;
  varying float vY;

  // Ashima simplex noise, 3D.
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);
    vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);
    vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);
    vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;
    vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);
    vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;
    vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
    vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);
    vec3 p1=vec3(a0.zw,h.y);
    vec3 p2=vec3(a1.xy,h.z);
    vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main() {
    vec3 n = normalize(position);
    float t = uTime;

    // Broad, slow swell.
    float swell = snoise(n * 0.85 + vec3(0.0, t * 0.14, t * 0.09));
    // Two travelling folds on tilted axes — the creases.
    float f1 = sin(dot(n, normalize(vec3(0.6, 1.0, 0.3))) * 3.4 + t * 0.6 + swell * 2.6);
    float f2 = sin(dot(n, normalize(vec3(-0.8, 0.4, 0.7))) * 2.6 - t * 0.45 + swell * 2.0);
    float fold = pow(abs(f1), 10.0) * 0.7 + pow(abs(f2), 12.0) * 0.5;
    // Fine shimmer, mostly when talking.
    float fine = snoise(n * 3.0 + t * 0.6) * (0.04 + uLevel * 0.5);

    float d = uAmp * (swell * 0.7 + fold * 0.8 + fine * 0.25);
    vec3 p = n * (1.0 + d);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    vec3 nView = normalize(normalMatrix * n);
    vFacing = nView.z;                 // 1 facing the camera, -1 far side
    vCrest = clamp(fold * 1.2 + max(swell, 0.0) * 0.3, 0.0, 1.0);
    vY = n.y;

    float size = uSize * (0.85 + aSeed * 0.3) * (0.75 + vCrest * 0.6);
    gl_PointSize = size * uPixelRatio * (6.0 / -mv.z);
  }
`

const fragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;
  uniform vec3 uTint;
  uniform float uLevel;
  uniform float uOpen;
  varying float vFacing;
  varying float vCrest;
  varying float vY;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float dotMask = smoothstep(0.5, 0.28, r);

    // Pink crown → violet → blue underside, with the phase colour leaning on the crown.
    float y = vY * 0.5 + 0.5;
    vec3 col = mix(uBottom, uMid, smoothstep(0.05, 0.5, y));
    col = mix(col, mix(uTop, uTint, 0.25), smoothstep(0.45, 0.85, y));

    // Hollow shell: the far side is a faint lattice, the near side carries the light.
    float front = smoothstep(-0.35, 0.6, vFacing);
    float rim = pow(1.0 - abs(vFacing), 2.0);
    float light = 0.06 + front * 0.32 + rim * 0.6 + vCrest * 0.85 + uLevel * 0.25;

    gl_FragColor = vec4(col * light, dotMask * light * uOpen);
  }
`

/** Fibonacci sphere — evenly spaced dots, which is what makes the lattice read as fabric. */
function fibonacciSphere(count: number) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const rad = Math.sqrt(1 - y * y)
    const th = golden * i
    pos[i * 3] = Math.cos(th) * rad
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = Math.sin(th) * rad
    seed[i] = Math.random()
  }
  return { pos, seed }
}

/** Fraction of the shorter viewport side the orb's diameter takes up. */
const FIT = 0.5

export function Orb({ drive }: { drive: Drive }) {
  const points = useRef<THREE.Points>(null)
  const mat = useRef<THREE.ShaderMaterial>(null)
  const viewport = useThree((s) => s.viewport)
  const dpr = useThree((s) => s.viewport.dpr)

  const geometry = useMemo(() => {
    const { pos, seed } = fibonacciSphere(COUNT)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uAmp: { value: 0.12 },
      uSize: { value: 1.7 },
      uPixelRatio: { value: 1 },
      uOpen: { value: 0 },
      uTop: { value: new THREE.Color('#ff3d9a') },
      uMid: { value: new THREE.Color('#b13cff') },
      uBottom: { value: new THREE.Color('#3d5cff') },
      uTint: { value: new THREE.Color('#ff4fa8') },
    }),
    [],
  )

  useFrame((_, dt) => {
    if (!mat.current || !points.current) return
    const u = mat.current.uniforms
    const r = drive.reactor

    points.current.visible = r.visible
    const fit = Math.min(viewport.width, viewport.height)
    points.current.scale.setScalar(((fit * FIT) / 2) * r.scale)
    points.current.rotation.y += dt * 0.06 * r.spin * drive.spin
    points.current.rotation.x = Math.sin(u.uTime.value * 0.05) * 0.25

    u.uLevel.value += (drive.level - u.uLevel.value) * Math.min(1, dt * 8)
    // Accumulated rather than derived from elapsed time, so a burst of speech
    // speeds the flow up without rewriting the shape that is already there.
    u.uTime.value += dt * (0.6 + u.uLevel.value * 1.6) * r.spin
    const ampWant = 0.08 + drive.amp * 0.9 + u.uLevel.value * 0.16
    u.uAmp.value += (ampWant - u.uAmp.value) * Math.min(1, dt * 3)
    u.uOpen.value += (Math.min(1, drive.open) - u.uOpen.value) * Math.min(1, dt * 1.6)
    u.uPixelRatio.value = dpr
    ;(u.uTint.value as THREE.Color).lerp(r.color, Math.min(1, dt * 2.5))
  })

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}
