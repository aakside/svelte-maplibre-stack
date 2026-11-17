import { expect, it, vi } from "vitest";
import { OverlayGesture } from "../src/lib/overlay-gesture.js";
it("rolls back single-finger movement when a second finger begins a pinch", () => {
  let anchor = 0;
  const gesture = new OverlayGesture<number>(() => {});
  expect(gesture.pointerDown(1)).toBe(true);
  gesture.start(0, () => {
    anchor = 0;
  });
  anchor = 10;
  expect(gesture.pointerDown(2)).toBe(false);
  expect(anchor).toBe(0);
  expect(gesture.value).toBeUndefined();
  gesture.pointerUp(2);
  expect(gesture.value).toBeUndefined();
  gesture.pointerUp(1);
  expect(gesture.pointerDown(3)).toBe(true);
});
it("commits a one-pointer drag, but rolls back cancellation", () => {
  const rollback = vi.fn(),
    release = vi.fn();
  const gesture = new OverlayGesture<string>(release);
  gesture.pointerDown(1);
  gesture.start("overlay", rollback);
  gesture.pointerUp(1);
  expect(rollback).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  gesture.pointerDown(2);
  gesture.start("overlay", rollback);
  gesture.cancel();
  expect(rollback).toHaveBeenCalledOnce();
  expect(gesture.value).toBeUndefined();
});
