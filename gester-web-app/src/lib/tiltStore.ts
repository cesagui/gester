export type TiltReading = {
  pitch: number;
  roll: number;
  magnitude: number;
};

type Listener = (reading: TiltReading) => void;

const listeners = new Set<Listener>();

export const tiltStore = {
  publish(reading: TiltReading) {
    listeners.forEach((l) => l(reading));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
