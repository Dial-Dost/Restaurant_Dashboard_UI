"use client";

import { Suspense, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import BrandObject from "./BrandObject";
import ParticleField from "./ParticleField";
import { damp, lerp, scrollState, seg, smoothstep } from "@/lib/experio/scroll";
import { pointer } from "@/lib/experio/pointer";

/**
 * Camera: an opening dolly-in, then stillness, then the finale reverse
 * dolly-zoom — fov drains to 10° while the camera retreats so the object
 * holds its exact screen size as perspective leaves it.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame((_, dt) => {
    const p = scrollState.progress;
    let fov = 34;
    let z = lerp(7.2, 6.5, smoothstep(seg(p, 0, 0.06)));
    const flat = smoothstep(seg(p, 0.89, 0.94));
    if (flat > 0) {
      fov = lerp(34, 10, flat);
      z =
        6.5 *
        (Math.tan(THREE.MathUtils.degToRad(17)) / Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    }
    const tx = scrollState.reducedMotion || !pointer.inside ? 0 : pointer.nx * 0.06;
    const ty = scrollState.reducedMotion || !pointer.inside ? 0 : pointer.ny * 0.04;
    camera.position.x = damp(camera.position.x, tx, 4, dt);
    camera.position.y = damp(camera.position.y, ty, 4, dt);
    camera.position.z = z;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

const LIGHT_ORIGIN = new THREE.Vector3();

/** A faint warm point light that tracks the cursor — the glass answers the hand. */
function CursorLight() {
  const ref = useRef<THREE.PointLight>(null!);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const viewportHelper = useThree((s) => s.viewport);
  useFrame((_, dt) => {
    const vp = viewportHelper.getCurrentViewport(camera, LIGHT_ORIGIN);
    const tx = pointer.inside ? (pointer.nx * vp.width) / 2 : 0;
    const ty = pointer.inside ? (pointer.ny * vp.height) / 2 : 0;
    ref.current.position.x = damp(ref.current.position.x, tx, 6, dt);
    ref.current.position.y = damp(ref.current.position.y, ty, 6, dt);
  });
  return <pointLight ref={ref} color="#E8C75D" intensity={0.5} distance={5} position={[0, 0, 1.6]} />;
}

/**
 * The persistent 3D layer: one canvas, one brand object, one particle field.
 * It never unmounts — every act only changes where things are and how they move.
 */
export default function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 34 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
      aria-hidden
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 5, 4]} intensity={0.7} />
        {/* Studio-style environment built from lightformers — no HDR download. */}
        <Environment resolution={256} frames={1}>
          <Lightformer intensity={1.8} position={[0, 4, 3]} scale={[10, 4, 1]} color="#ffffff" />
          <Lightformer intensity={1.1} position={[-5, 1, 2]} rotation-y={0.8} scale={[4, 7, 1]} color="#fff6dd" />
          <Lightformer intensity={0.9} position={[5, -0.5, 2]} rotation-y={-0.8} scale={[3, 6, 1]} color="#D4AF37" />
          <Lightformer intensity={2.2} position={[0, -5, 1]} rotation-x={Math.PI / 2} scale={[9, 9, 1]} color="#ffffff" />
          <Lightformer intensity={0.7} position={[0, 0, -6]} scale={[12, 12, 1]} color="#faf7ef" />
        </Environment>
        <BrandObject />
        <ParticleField />
        <CameraRig />
        <CursorLight />
      </Suspense>
    </Canvas>
  );
}
