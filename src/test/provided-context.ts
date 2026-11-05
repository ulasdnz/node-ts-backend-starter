// Values the Vitest global setup hands to test files, which read them with `inject`
declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export {};
