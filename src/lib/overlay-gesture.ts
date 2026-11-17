/** A second pointer belongs to the camera; never commit a partial pinch as a drag. */
export class OverlayGesture<T> {
  private pointers = new Set<number>();
  private rollback?: () => void;
  value?: T;
  constructor(private release: () => void) {}
  pointerDown(id: number) {
    this.pointers.add(id);
    if (this.pointers.size !== 1) {
      this.rollback?.();
      this.finish();
      return false;
    }
    return true;
  }
  start(value: T, rollback: () => void) {
    this.value = value;
    this.rollback = rollback;
  }
  pointerUp(id: number) {
    this.pointers.delete(id);
    this.finish();
  }
  cancel() {
    this.rollback?.();
    this.pointers.clear();
    this.finish();
  }
  private finish() {
    this.value = undefined;
    this.rollback = undefined;
    this.release();
  }
}
