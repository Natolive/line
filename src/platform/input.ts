// Keyboard and touch → driving input. Held keys are polled each frame; one-shot keys fire handlers.
import type { DriveInput } from '../rules/vehicle.ts';

export type InputHandlers = { action(): void; cycle(dir: -1 | 1): void; pause(): void; mute(): void; battle(): void; tap(): void };

export class Input {
  private keys = new Set<string>();
  private pointers = new Map<number, -1 | 0 | 1>(); // which screen zone each finger holds
  private touch = false;

  constructor(h: InputHandlers) {
    addEventListener('keydown', (e) => {
      if ((e.target as Element).closest?.('input')) return; // typing a name or room code
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      // e.code is the physical key: WASD also covers ZQSD on AZERTY keyboards
      if (e.code === 'Space' || e.code === 'Enter') h.action();
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') h.cycle(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') h.cycle(1);
      else if (e.code === 'KeyP' || e.code === 'Escape') h.pause();
      else if (e.code === 'KeyM') h.mute();
      else if (e.code === 'KeyB') h.battle();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button, input, form')) return;
      this.touch ||= e.pointerType === 'touch';
      const third = innerWidth / 3;
      this.pointers.set(e.pointerId, e.clientX < third ? -1 : e.clientX > third * 2 ? 1 : 0);
      h.tap();
    });
    const release = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }

  read(): DriveInput {
    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    let steer = (held('ArrowRight', 'KeyD') ? 1 : 0) - (held('ArrowLeft', 'KeyA') ? 1 : 0);
    let brake = held('ArrowDown', 'KeyS') ? 1 : 0;
    let throttle = held('ArrowUp', 'KeyW') ? 1 : 0;
    // touch: hold the left/right third to steer, the middle to brake; throttle is automatic
    for (const zone of this.pointers.values()) zone === 0 ? (brake = 1) : (steer += zone);
    if (this.touch && !brake) throttle = 1;
    return { steer: Math.max(-1, Math.min(1, steer)), throttle, brake };
  }
}
