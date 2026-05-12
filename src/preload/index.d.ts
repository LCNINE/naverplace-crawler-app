export {};

declare global {
  interface Window {
    api: {
      invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>;
      on: (channel: string, listener: (payload: unknown) => void) => () => void;
    };
  }
}
