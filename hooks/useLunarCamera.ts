"use client";
/**
 * UI-side access to the constrained camera rig registered by CameraController.
 * Calls are no-ops until the WebGL scene has mounted.
 */
import { useCallback } from "react";
import { store, useAppStore } from "@/lib/store";

export function useLunarCamera() {
  const ready = useAppStore((s) => s.cameraApi !== null);
  const viewMode = useAppStore((s) => s.viewMode);
  const animating = useAppStore((s) => s.animating);

  const flyToSouthPole = useCallback(() => store.get().cameraApi?.flyToSouthPole(), []);
  const returnToGlobalView = useCallback(() => store.get().cameraApi?.returnToGlobalView(), []);
  const zoomIn = useCallback(() => store.get().cameraApi?.zoomBy(0.55), []);
  const zoomOut = useCallback(() => store.get().cameraApi?.zoomBy(1 / 0.55), []);
  const resetCamera = useCallback(() => store.get().cameraApi?.resetCamera(), []);

  return { ready, viewMode, animating, flyToSouthPole, returnToGlobalView, zoomIn, zoomOut, resetCamera };
}
