"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { ACTS, clamp01, damp, detent, lerp, scrollState, seg, smoothstep } from "@/lib/experio/scroll";
import { objectState } from "@/lib/experio/stage";
import { pointer } from "@/lib/experio/pointer";

const GOLD = "#D4AF37";

/** Frame-loop scratch — never allocate inside useFrame. */
const ORIGIN = new THREE.Vector3();
const PROJ = new THREE.Vector3();

/** Normalized screen anchor (x right, y up, -1..1) for each story beat. */
const ANCHOR = {
  hero: { nx: 0.32, ny: 0.0 },
  dock: { nx: -0.66, ny: 0.42 },
  center: { nx: 0, ny: 0.04 },
};

/** Height of the object as a fraction of viewport height per beat. */
const SIZE = { hero: 0.44, dock: 0.21, center: 0.32 };

/** Portrait (mobile) recomposition: object above the copy, docked top-center. */
const ANCHOR_P = {
  hero: { nx: 0.04, ny: 0.42 },
  dock: { nx: 0, ny: 0.86 },
  center: { nx: 0, ny: 0.1 },
};
const SIZE_P = { hero: 0.24, dock: 0.1, center: 0.2 };

export default function BrandObject() {
  const root = useRef<THREE.Group>(null!);
  const aim = useRef<THREE.Group>(null!);
  const shell = useRef<THREE.Mesh>(null!);
  const core = useRef<THREE.Mesh>(null!);
  const wire = useRef<THREE.LineSegments>(null!);
  const bandEq = useRef<THREE.Group>(null!);
  const bandMid = useRef<THREE.Group>(null!);
  const bandMer = useRef<THREE.Group>(null!);
  const studs = useRef<THREE.InstancedMesh>(null!);
  const activeStud = useRef<THREE.Mesh>(null!);
  const flywheel = useRef({ vel: 0.05 });

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const viewportHelper = useThree((s) => s.viewport);
  const size = useThree((s) => s.size);

  const geos = useMemo(() => {
    const shellGeo = new THREE.IcosahedronGeometry(1.0, 1);
    const wireGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.02, 1));
    const coreGeo = new THREE.OctahedronGeometry(0.45, 0);
    const band = (r: number, h: number) =>
      new THREE.CylinderGeometry(r, r, h, 96, 1, true);
    return {
      shellGeo,
      wireGeo,
      coreGeo,
      bandEqGeo: band(1.18, 0.11),
      bandMidGeo: band(1.38, 0.075),
      bandMerGeo: band(1.58, 0.05),
      studGeo: new THREE.SphereGeometry(0.024, 12, 12),
      pinGeo: new THREE.ConeGeometry(0.04, 0.12, 16),
    };
  }, []);

  const goldMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: GOLD,
        metalness: 1,
        roughness: 0.32,
        envMapIntensity: 1.4,
        emissive: "#2A1F05",
        emissiveIntensity: 0.35,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    []
  );

  const coreMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#0B0B0E",
        metalness: 0.25,
        roughness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        flatShading: true,
        emissive: GOLD,
        emissiveIntensity: 0.03,
        transparent: true,
      }),
    []
  );

  const wireMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.1 }),
    []
  );

  const activeStudMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#fff6dd",
        emissiveIntensity: 1.6,
        transparent: true,
      }),
    []
  );

  // Seat the 12 index studs around the equatorial band once.
  const studMatrices = useMemo(() => {
    const m: THREE.Matrix4[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.push(new THREE.Matrix4().setPosition(Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18));
    }
    return m;
  }, []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 30);
    const p = scrollState.progress;
    const t = state.clock.elapsedTime;
    const reduced = scrollState.reducedMotion;

    // Current world size of the viewport at the object's plane.
    const vp = viewportHelper.getCurrentViewport(camera, ORIGIN);
    const anchor = (a: { nx: number; ny: number }) => ({
      x: (a.nx * vp.width) / 2,
      y: (a.ny * vp.height) / 2,
    });

    /* ---- position + scale across the five acts (screen-anchored) ---- */
    // Compact composition whenever the dashboard takes the full width (< lg).
    const portrait = size.width < 1024 || vp.width / vp.height < 0.75;
    const A = portrait ? ANCHOR_P : ANCHOR;
    const S = portrait ? SIZE_P : SIZE;
    const hero = anchor(A.hero);
    const dock = anchor(A.dock);
    const center = anchor(A.center);
    const sHero = (S.hero * vp.height) / 3.2;
    const sDock = (S.dock * vp.height) / 3.2;
    const sCenter = (S.center * vp.height) / 3.2;

    let x = hero.x;
    let y = hero.y;
    let s = sHero;

    // The act-1 drift completes exactly at p=0.1, and the act-2 arc departs
    // from the drifted point — the handoff is C0-continuous, no pop.
    const driftX = vp.width * 0.03;
    const driftY = vp.height * 0.02;

    if (p < 0.1) {
      // Act 1: hold, breathe, begin to lean.
      const drift = smoothstep(seg(p, 0.06, 0.1));
      x = hero.x - drift * driftX;
      y = hero.y + drift * driftY;
    } else if (p < 0.3) {
      // Act 2: one continuous arc up-left to the dock.
      const hx = hero.x - driftX;
      const hy = hero.y + driftY;
      const f = smoothstep(seg(p, 0.1, 0.3));
      // Quadratic bezier with a raised control point — an arc, not a slide.
      const cx = (hx + dock.x) / 2;
      const cy = Math.max(hy, dock.y) + vp.height * 0.18;
      const u = 1 - f;
      x = u * u * hx + 2 * u * f * cx + f * f * dock.x;
      y = u * u * hy + 2 * u * f * cy + f * f * dock.y;
      s = lerp(sHero, sDock, f);
    } else if (p < ACTS.network.a) {
      // Act 3: docked selector dial.
      x = dock.x;
      y = dock.y;
      s = sDock;
    } else if (p < 0.64) {
      // Act 4 entry: glide to dead center.
      const f = smoothstep(seg(p, ACTS.network.a, 0.64));
      x = lerp(dock.x, center.x, f);
      y = lerp(dock.y, center.y, f);
      s = lerp(sDock, sCenter, f);
    } else {
      x = center.x;
      y = center.y;
      s = sCenter;
    }

    // Idle breath (act 1 strongest, fades once docked).
    if (!reduced) {
      const breathAmt = lerp(0.012, 0.004, smoothstep(seg(p, 0.1, 0.3))) * vp.height;
      y += Math.sin(t * 1.05) * breathAmt;
    }

    root.current.position.set(x, y, 0);
    root.current.scale.setScalar(s);

    /* ---------------- flywheel: rings pick up scroll velocity ---------------- */
    const fw = flywheel.current;
    const targetVel = reduced ? 0 : 0.05 + Math.min(1.6, Math.abs(scrollState.velocity) * 0.9);
    fw.vel = damp(fw.vel, targetVel, 0.8, dt);
    const spin = fw.vel * dt;

    /* ------------------------- selector dial (act 3) ------------------------- */
    const vSeg = (ACTS.views.b - ACTS.views.a) / 6;
    const vp3 = seg(p, ACTS.views.a, ACTS.views.b);
    const slot = Math.min(5, Math.floor(vp3 * 6));
    const frac = clamp01(vp3 * 6 - slot);
    const dialAngle = ((slot + detent(frac)) * Math.PI) / 6; // 30° per view

    // Core pulse near each detent boundary.
    let pulse = 0;
    for (let k = 1; k <= 5; k++) {
      const b = ACTS.views.a + k * vSeg;
      const g = Math.exp(-Math.pow((p - b) / 0.004, 2));
      pulse = Math.max(pulse, g);
    }

    /* -------------------- finale: merge, flatten, hand off ------------------- */
    const sink = smoothstep(seg(p, 0.85, 0.89)); // shell + outer bands sink/merge
    const flat = smoothstep(seg(p, 0.89, 0.94)); // orientation locks to the mark
    const fade = smoothstep(seg(p, 0.93, 0.96)); // 3D → DOM logomark crossfade

    /* ----------------------------- orientation ------------------------------ */
    // Base cant + slow presentation turn, pointer parallax ≤ 2°.
    const yawBase = -0.28 + Math.sin(t * 0.11) * (reduced ? 0 : 0.05);
    const buildYaw = smoothstep(seg(p, 0.1, 0.22)) * 0.5; // turns to watch its work
    const centerYaw = -smoothstep(seg(p, 0.58, 0.66)) * 0.35;
    const px = pointer.inside && !reduced ? pointer.ny * -0.035 : 0;
    const py = pointer.inside && !reduced ? pointer.nx * 0.035 : 0;

    const targetRotX = lerp(0.16 + px, 0, flat);
    const targetRotY = lerp(yawBase + buildYaw + centerYaw + py, 0, flat);
    aim.current.rotation.x = damp(aim.current.rotation.x, targetRotX, 6, dt);
    aim.current.rotation.y = damp(aim.current.rotation.y, targetRotY, 6, dt);
    aim.current.rotation.z = lerp(0.06, 0, flat);

    /* -------------------------------- bands --------------------------------- */
    // Equatorial band: idle spin + selector dial + finale settle at -28°.
    bandEq.current.rotation.y += spin;
    bandEq.current.rotation.x = lerp(0.14, THREE.MathUtils.degToRad(67), flat);
    bandEq.current.rotation.z = lerp(0, THREE.MathUtils.degToRad(-28), flat);
    bandEq.current.rotation.y += (dialAngle - (bandEq.current.userData.dial ?? 0));
    bandEq.current.userData.dial = dialAngle;

    // Match-cut: mid + meridian bands tilt edge-on to camera at 0.62–0.66,
    // then live as faint ghosts, then merge into the equator in the finale.
    const edgeOn = smoothstep(seg(p, 0.62, 0.66));
    bandMid.current.rotation.y -= spin * 0.65;
    bandMer.current.rotation.y += spin * 0.4;
    bandMid.current.rotation.x = lerp(THREE.MathUtils.degToRad(62), Math.PI / 2, Math.max(edgeOn, sink));
    bandMer.current.rotation.z = lerp(THREE.MathUtils.degToRad(20), 0, Math.max(edgeOn, sink));

    const mergeScale = (base: number) => lerp(1, 1.18 / base, sink);
    bandMid.current.scale.setScalar(mergeScale(1.38));
    bandMer.current.scale.setScalar(mergeScale(1.58));

    // Ghost the outer bands as the object becomes the hub (act 4).
    const ghost = smoothstep(seg(p, 0.64, 0.7)) * (1 - sink);
    const bandOpacity = (1 - fade) * lerp(1, 0.4, ghost);

    /* --------------------------------- core ---------------------------------- */
    core.current.rotation.y -= spin * 0.5 * (1 - flat);
    core.current.rotation.y = lerp(core.current.rotation.y, Math.PI / 4, flat);
    core.current.rotation.x *= 1 - flat;
    const coreScale = 1 + pulse * 0.06;
    core.current.scale.set(coreScale, 1.4 * coreScale, coreScale);
    coreMat.emissiveIntensity = 0.03 + pulse * 0.06;

    /* --------------------------------- shell --------------------------------- */
    shell.current.rotation.y += spin * 0.12;
    const shellScale = lerp(1, 0.3, sink);
    shell.current.scale.setScalar(Math.max(0.0001, shellScale));
    wire.current.rotation.copy(shell.current.rotation);
    wire.current.scale.copy(shell.current.scale);

    /* ------------------------------- opacity --------------------------------- */
    const o = 1 - fade;
    goldMat.opacity = bandOpacity;
    coreMat.opacity = o;
    wireMat.opacity = 0.1 * (1 - sink) * o;
    activeStudMat.opacity = o;
    const shellMat = shell.current.material as THREE.Material & { opacity: number };
    shellMat.opacity = (1 - sink * 0.85) * o;

    /* ------------------------------ index studs ------------------------------ */
    if (!studs.current.userData.seated) {
      studMatrices.forEach((m, i) => studs.current.setMatrixAt(i, m));
      studs.current.instanceMatrix.needsUpdate = true;
      studs.current.userData.seated = true;
    }
    const inViews = seg(p, ACTS.views.a - 0.02, ACTS.views.a) * (1 - seg(p, ACTS.views.b, ACTS.views.b + 0.02));
    const a = (slot / 12) * Math.PI * 2;
    activeStud.current.position.set(Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18);
    activeStud.current.scale.setScalar(1 + pulse * 0.9);
    activeStud.current.visible = inViews > 0.01 && o > 0.05;

    /* --------------------- publish state for the DOM layer -------------------- */
    objectState.x = x;
    objectState.y = y;
    objectState.scale = s;
    objectState.flatten = flat;
    objectState.opacity = o;
    PROJ.set(x, y, 0).project(camera);
    objectState.sx = ((PROJ.x + 1) / 2) * size.width;
    objectState.sy = ((1 - PROJ.y) / 2) * size.height;
    const worldR = 1.6 * s;
    const dist = camera.position.z;
    objectState.sr =
      (worldR / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist)) * (size.height / 2);
  });

  return (
    <group ref={root}>
      <group ref={aim}>
        {/* Obsidian core */}
        <mesh ref={core} geometry={geos.coreGeo} material={coreMat} />

        {/* Glass shell */}
        <mesh ref={shell} geometry={geos.shellGeo}>
          <MeshTransmissionMaterial
            transmission={1}
            thickness={1.2}
            ior={1.5}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.12}
            attenuationColor="#F5E7C6"
            attenuationDistance={6}
            envMapIntensity={1.1}
            resolution={512}
            samples={6}
            chromaticAberration={0.01}
            anisotropicBlur={0.04}
            distortion={0}
            background={new THREE.Color("#ffffff")}
            transparent
          />
        </mesh>

        {/* Drafting wireframe */}
        <lineSegments ref={wire} geometry={geos.wireGeo} material={wireMat} />

        {/* Equatorial band + studs (the selector dial) */}
        <group ref={bandEq}>
          <mesh geometry={geos.bandEqGeo} material={goldMat} />
          <instancedMesh ref={studs} args={[geos.studGeo, goldMat, 12]} />
          <mesh ref={activeStud} geometry={geos.studGeo} material={activeStudMat} scale={1.4} />
        </group>

        {/* Outer gimbal bands */}
        <group ref={bandMid} rotation={[THREE.MathUtils.degToRad(62), 0, 0]}>
          <mesh geometry={geos.bandMidGeo} material={goldMat} />
        </group>
        <group ref={bandMer} rotation={[Math.PI / 2, 0, THREE.MathUtils.degToRad(20)]}>
          <mesh geometry={geos.bandMerGeo} material={goldMat} />
        </group>

        {/* Axis pins */}
        <mesh geometry={geos.pinGeo} material={goldMat} position={[0, 1.08, 0]} />
        <mesh
          geometry={geos.pinGeo}
          material={goldMat}
          position={[0, -1.08, 0]}
          rotation={[Math.PI, 0, 0]}
        />
      </group>
    </group>
  );
}
