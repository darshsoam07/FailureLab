export type ScreenTab = 'dashboard' | 'experiments' | 'reports' | 'topology' | 'settings';

export interface TopologyNode {
  id: string;
  name: string;
  category: 'Gateway' | 'Persistence' | 'Message Queue' | 'Async Worker' | 'Chaos Proxy' | 'Downstream';
  subtitle: string;
  stat: string;
  port?: number | string;
  status: 'healthy' | 'warning' | 'chaos' | 'error';
  latencyMs: number;
  cpuPercent: number;
  memoryMb: number;
  replicas?: number;
  description: string;
}

export interface MetricPoint {
  time: string;
  timestamp: number;
  p50: number;
  p95: number;
}

export interface ChaosExperiment {
  id: string;
  name: string;
  targetNodeId: string;
  targetNodeName: string;
  toxicType: 'latency' | 'bandwidth' | 'slow_close' | 'timeout' | 'slicer';
  params: {
    latencyMs?: number;
    jitterMs?: number;
    rateLimitKb?: number;
    dropPercentage?: number;
  };
  durationSeconds: number;
  blastRadius: number; // percentage
  status: 'ready' | 'running' | 'completed' | 'aborted';
  startedAt?: number;
  remainingSeconds?: number;
  result?: {
    maxP95: number;
    errorRate: number;
    sloBreached: boolean;
    mttrSeconds: number;
    resilienceScore: number;
  };
}

export interface TerminalLog {
  id: string;
  timestamp: string;
  service: string;
  level: 'info' | 'warn' | 'error' | 'chaos';
  message: string;
}

export interface GuardrailAlert {
  id: string;
  timestamp: string;
  type: 'info' | 'warning' | 'danger';
  title: string;
  description: string;
  read: boolean;
}

export interface ClusterOption {
  id: string;
  name: string;
  region: string;
  activeNodes: number;
  guardrails: number;
}
