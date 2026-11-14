/**
 * Per-frame values shared between scene components without React (written by
 * CameraController every frame; the UI store gets a throttled copy) and the
 * DOM elements of the pole labels, positioned directly from the render loop.
 */
export const frameState = {
  /** 0 = global view … 1 = camera focused on the South Pole. */
  poleFocus: 0,
};

export const poleLabelEls: {
  south: HTMLDivElement | null;
  north: HTMLDivElement | null;
  northCue: HTMLSpanElement | null;
} = { south: null, north: null, northCue: null };
