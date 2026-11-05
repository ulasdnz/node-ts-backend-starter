declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }

    interface Locals {
      /** Mount path of the innermost router the request entered (see createRouter). */
      routeBase?: string;
    }
  }
}
export {};
