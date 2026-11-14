"use client";
/**
 * The global Moon: LROC WAC colour mosaic on a sphere displaced by the LOLA
 * global DEM (same vertical exaggeration as the polar terrain), shaded with a
 * normal map derived from that DEM. South of 80°S the globe hands over to the
 * high-resolution SouthPoleTerrain via a dithered cross-fade.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { MOON_RADIUS_KM } from "@/lib/lunar-config";
import { GLOBE_FRAGMENT, GLOBE_VERTEX, sharedUniforms } from "@/lib/shaders";
import { useLunarRegistry } from "@/hooks/useLunarData";

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();
const placeholderHeight = (() => {
  const t = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
  t.needsUpdate = true;
  return t;
})();

export default function MoonSphere() {
  const data = useLunarRegistry();
  const globe = data.globe;

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 720, 360), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOBE_VERTEX,
        fragmentShader: GLOBE_FRAGMENT,
        uniforms: {
          ...sharedUniforms,
          uColor: { value: placeholder },
          uNormal: { value: placeholder },
          uHeight: { value: placeholderHeight },
          uHasTex: { value: 0 },
          uHasHeight: { value: 0 },
        },
      }),
    [],
  );

  useEffect(() => {
    if (!globe) return;
    material.uniforms.uColor.value = globe.color;
    material.uniforms.uNormal.value = globe.normal;
    material.uniforms.uHeight.value = globe.height;
    material.uniforms.uHasTex.value = 1;
    material.uniforms.uHasHeight.value = 1;
  }, [globe, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <group>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
      {/* Dark inner core: anything seen through a sub-pixel seam reads as shadow, not space. */}
      <mesh frustumCulled={false}>
        <sphereGeometry args={[MOON_RADIUS_KM - 45, 96, 48]} />
        <meshBasicMaterial color="#060607" />
      </mesh>
    </group>
  );
}
