export type CoinAnimationEventType = "animationiteration" | "animationend";

export function waitForCoinAnimationEvent(
  element: HTMLElement | null,
  eventType: CoinAnimationEventType,
  animationNames: readonly string[],
  fallbackMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (element) element.removeEventListener(eventType, handleAnimation);
      clearTimeout(timeoutId);
      resolve();
    };

    const handleAnimation = (event: Event) => {
      const animationEvent = event as AnimationEvent;
      if (event.target !== element || !animationNames.includes(animationEvent.animationName)) return;
      finish();
    };

    if (element) element.addEventListener(eventType, handleAnimation);
    timeoutId = setTimeout(finish, fallbackMs);
  });
}
