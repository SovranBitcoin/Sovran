/**
 * The unit pins of the screens bound right now, newest last. The machine reads
 * the newest; releasing a pin, wherever it sits, leaves the newest remaining
 * one in force, and none leaves the unit to the app's own `getUnit`.
 */
export function createUnitPins(unitRef: { current: string | undefined }) {
  const pins: { unit: string }[] = [];
  return (unit: string): (() => void) => {
    const pin = { unit };
    pins.push(pin);
    unitRef.current = unit;
    return () => {
      const index = pins.indexOf(pin);
      if (index < 0) return;
      pins.splice(index, 1);
      unitRef.current = pins.at(-1)?.unit;
    };
  };
}
