export type ServiceStatus = 'healthy' | 'unhealthy';

/** `degraded`: serving requests, but with a non-critical dependency down. */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
  };
  services: Record<string, ServiceStatus>;
}

export interface ReadinessResponse {
  ready: boolean;
}

export interface LivenessResponse {
  alive: boolean;
}
