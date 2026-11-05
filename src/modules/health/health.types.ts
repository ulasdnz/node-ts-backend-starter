export type ServiceStatus = 'healthy' | 'unhealthy';

export interface HealthResponse {
  status: ServiceStatus;
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
