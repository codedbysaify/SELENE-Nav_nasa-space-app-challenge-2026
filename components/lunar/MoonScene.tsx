"use client";
/**
 * The WebGL scene: globe, South Pole terrain, pole markers, constrained camera.
 * Scene units are kilometres; see lib/lunar-config.ts for the frame definition.
 */
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA, MOON_RADIUS_KM } from "@/lib/lunar-config";
import { useLunarDataLoader } from "@/hooks/useLunarData";
import MoonSphere from "./MoonSphere";
import SouthPoleTerrain from "./SouthPoleTerrain";
import PoleMarkers from "./PoleMarkers";
import CameraController from "./CameraController";
import TerrainLayers from "./TerrainLayers";
import Starfield from "./Starfield";

function DataLoader() {
  useLunarDataLoader();
  return null;
}

export default function MoonScene() {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, 1.75]}
      flat
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
      camera={{ fov: CAMERA.fovDeg, near: 1, far: 20000, position: [0, -1.9 * MOON_RADIUS_KM, 2.8 * MOON_RADIUS_KM] }}
      onCreated={({ gl, scene, get }) => {
        gl.setClearColor("#030509", 1);
        // Development-only handle for automated visual tests.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __selene?: unknown }).__selene = { gl, scene, get };
      }}
    >
      <DataLoader />
      <Starfield />
      <MoonSphere />
      <SouthPoleTerrain />
      <PoleMarkers />
      <TerrainLayers />
      <CameraController />
    </Canvas>
  );
}
