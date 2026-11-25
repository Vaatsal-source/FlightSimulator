/**
 * Level-of-detail rules for the streamed trees (pure, so they can be tested).
 * Near trees are detailed and cast shadows; far trees are cheap and are only
 * kept in front of the camera.
 */

/** Trees nearer than this (m) use the detailed model and cast shadows; the rest are the cheap one. */
export const TREE_NEAR_DISTANCE = 700
/** Trees nearer than this are kept whatever the view direction (their shadows can fall into view). */
export const KEEP_ALL_DISTANCE = 300
/** Extra view angle (rad) kept beyond the screen edge; the instances are rewritten before it is used up. */
const VIEW_MARGIN = 0.4
export const YAW_REWRITE = 0.15

/** The half-angle (rad) of the horizontal view cone kept for distant trees, or null when the view is near-vertical. */
export function viewHalfAngle(fovDeg: number, aspect: number, forwardHorizontal: number): number | null {
  if (forwardHorizontal < 0.35) return null // looking almost straight up or down: keep every direction
  // atan() saturates at 90 degrees, so even a very wide lens keeps a cone narrower than the whole circle.
  return Math.atan(Math.tan((fovDeg * Math.PI) / 360) * Math.max(aspect, 1)) + VIEW_MARGIN
}
