import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  ScreenTab,
  TopologyNode,
  MetricPoint,
  ChaosExperiment,
  TerminalLog,
  GuardrailAlert,
  ClusterOption,
} from '../types/chaos.ts';

interface ChaosContextType {
  currentScreen: ScreenTab;
  setCurrentScreen: (screen: ScreenTab) => void;
  currentCluster: string;
  setCurrentCluster: (cluster: string) => void;
  clusters: ClusterOption[];
  
  // Traffic state
  backgroundTraffic: boolean;
  setBackgroundTraffic: (enabled: boolean) => void;
  requestsPerSecond: number;
  setRequestsPerSecond: (rps: number) => void;
  totalAttempts: number;
  totalSuccesses: number;
  
  // Metrics
  p95Latency: number;
  errorRate: number;
  ordersPerSecond: number;
  ordersReserved: number;
  
  // Charts
  timeWindow: '5m' | '15m' | '1h' | '6h';
  setTimeWindow: (w: '5m' | '15m' | '1h' | '6h') => void;
  metricHistory: MetricPoint[];
  
  // Topology
  nodes: TopologyNode[];
  selectedNode: TopologyNode | null;
  setSelectedNode: (node: TopologyNode | null) => void;
  
  // Chaos & Experiments
  activeToxic: {
    type: string;
    target: string;
    latencyMs: number;
    jitterMs: number;
    running: boolean;
    remainingSeconds: number;
  } | null;
  experiments: ChaosExperiment[];
  injectToxic: (targetId: string, type: string, latencyMs: number, jitterMs?: number, duration?: number) => void;
  stopActiveToxic: () => void;
  emergencyStop: () => void;
  isEmergencyModalOpen: boolean;
  setIsEmergencyModalOpen: (open: boolean) => void;
  
  // Drawers & Modals
  isToxiproxyModalOpen: boolean;
  setIsToxiproxyModalOpen: (open: boolean) => void;
  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (open: boolean) => void;
  
  // Logs & Alerts
  terminalLogs: TerminalLog[];
  clearTerminalLogs: () => void;
  alerts: GuardrailAlert[];
  markAlertAsRead: (id: string) => void;
  dismissAllAlerts: () => void;
  unreadAlertCount: number;
  
  // Guardrail Status
  guardrailsActive: number;
  totalGuardrails: number;
  sloThresholdMs: number;
}

const ChaosContext = createContext<ChaosContextType | undefined>(undefined);

const INITIAL_NODES: TopologyNode[] = [
  {
    id: 'gateway',
    name: 'Order API',
    category: 'Gateway',
    subtitle: 'FastAPI :8000',
    stat: '24ms',
    port: 8000,
    status: 'healthy',
    latencyMs: 24,
    cpuPercent: 18,
    memoryMb: 312,
    replicas: 4,
    description: 'High-throughput ASGI edge gateway handling inbound HTTPS order creation requests and routing payload tokens.',
  },
  {
    id: 'persistence',
    name: 'PostgreSQL Outbox',
    category: 'Persistence',
    subtitle: 'pg-cluster-01',
    stat: '3ms',
    port: 5432,
    status: 'healthy',
    latencyMs: 3,
    cpuPercent: 32,
    memoryMb: 1420,
    replicas: 2,
    description: 'Primary transactional database table implementing transactional outbox pattern with WAL CDC streaming.',
  },
  {
    id: 'queue',
    name: 'RabbitMQ Broker',
    category: 'Message Queue',
    subtitle: 'order.events',
    stat: '0 lag',
    port: 5672,
    status: 'healthy',
    latencyMs: 1,
    cpuPercent: 14,
    memoryMb: 680,
    replicas: 3,
    description: 'Durable clustered AMQP message bus routing order fulfillment and inventory reservation events to workers.',
  },
  {
    id: 'worker',
    name: 'Fulfillment Worker',
    category: 'Async Worker',
    subtitle: '8 Replicas',
    stat: 'OK',
    port: 'K8s',
    status: 'healthy',
    latencyMs: 38,
    cpuPercent: 44,
    memoryMb: 890,
    replicas: 8,
    description: 'Asynchronous event consumer orchestrating warehouse reservation, packaging state, and tracking token dispatch.',
  },
  {
    id: 'toxiproxy',
    name: 'Toxiproxy Engine',
    category: 'Chaos Proxy',
    subtitle: 'Port :8474',
    stat: 'STANDBY',
    port: 8474,
    status: 'warning',
    latencyMs: 1,
    cpuPercent: 5,
    memoryMb: 94,
    description: 'TCP/gRPC fault injection proxy intercepting downstream calls to simulate latency, network jitter, bandwidth caps, and blackholes.',
  },
  {
    id: 'downstream',
    name: 'Inventory Service',
    category: 'Downstream',
    subtitle: 'gRPC :50051',
    stat: '18ms',
    port: 5051,
    status: 'healthy',
    latencyMs: 18,
    cpuPercent: 26,
    memoryMb: 420,
    replicas: 3,
    description: 'Core inventory catalog and stock decrement microservice communicating over binary Protocol Buffers RPC.',
  },
];

const INITIAL_EXPERIMENTS: ChaosExperiment[] = [
  {
    id: 'exp-101',
    name: 'Toxiproxy Downstream Latency Injection (+350ms)',
    targetNodeId: 'toxiproxy',
    targetNodeName: 'Toxiproxy Engine',
    toxicType: 'latency',
    params: { latencyMs: 350, jitterMs: 50 },
    durationSeconds: 60,
    blastRadius: 25,
    status: 'ready',
    result: {
      maxP95: 486,
      errorRate: 0.12,
      sloBreached: false,
      mttrSeconds: 3.8,
      resilienceScore: 96.4,
    },
  },
  {
    id: 'exp-102',
    name: 'Inventory Service gRPC Timeout & Slicer',
    targetNodeId: 'downstream',
    targetNodeName: 'Inventory Service',
    toxicType: 'timeout',
    params: { latencyMs: 1200 },
    durationSeconds: 45,
    blastRadius: 10,
    status: 'completed',
    result: {
      maxP95: 580,
      errorRate: 1.45,
      sloBreached: true,
      mttrSeconds: 6.2,
      resilienceScore: 84.1,
    },
  },
  {
    id: 'exp-103',
    name: 'RabbitMQ Consumer Queue Throttle',
    targetNodeId: 'queue',
    targetNodeName: 'RabbitMQ Broker',
    toxicType: 'bandwidth',
    params: { rateLimitKb: 128 },
    durationSeconds: 90,
    blastRadius: 50,
    status: 'ready',
  },
];

const INITIAL_LOGS: TerminalLog[] = [
  { id: '1', timestamp: '14:59:42.110', service: 'order-api', level: 'info', message: 'POST /v1/orders 201 Created duration=22.4ms payload=1.2KB' },
  { id: '2', timestamp: '14:59:45.328', service: 'pg-outbox', level: 'info', message: 'WAL batch commit: 14 txns processed to outbox table (pg-cluster-01)' },
  { id: '3', timestamp: '14:59:48.012', service: 'rabbitmq', level: 'info', message: 'Channel ack queue=order.events consumer=fulfillment-worker-4b8c' },
  { id: '4', timestamp: '14:59:51.654', service: 'toxiproxy', level: 'info', message: 'Proxy listener active on 0.0.0.0:8474 upstream=inventory:50051 (bypass mode)' },
  { id: '5', timestamp: '14:59:55.201', service: 'inventory-grpc', level: 'info', message: 'CheckStockSKU SKU-88493 stock_available=1420 latency=17.8ms' },
  { id: '6', timestamp: '15:00:00.000', service: 'guardrails', level: 'info', message: 'Health probe nominal: 12/12 watchdog policies satisfied, p95=124ms' },
];

export const ChaosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentScreen, setCurrentScreen] = useState<ScreenTab>('dashboard');
  const [currentCluster, setCurrentCluster] = useState<string>('cluster/prod-east-order-cluster');
  
  const clusters: ClusterOption[] = [
    { id: 'cluster/prod-east-order-cluster', name: 'cluster/prod-east-order-cluster', region: 'us-east-1', activeNodes: 6, guardrails: 12 },
    { id: 'cluster/prod-eu-billing-cluster', name: 'cluster/prod-eu-billing-cluster', region: 'eu-west-1', activeNodes: 8, guardrails: 14 },
    { id: 'cluster/staging-us-cart-cluster', name: 'cluster/staging-us-cart-cluster', region: 'us-central-1', activeNodes: 5, guardrails: 12 },
  ];

  // Traffic controls
  const [backgroundTraffic, setBackgroundTraffic] = useState<boolean>(true);
  const [requestsPerSecond, setRequestsPerSecond] = useState<number>(12);
  const [totalAttempts, setTotalAttempts] = useState<number>(142890);
  const [totalSuccesses, setTotalSuccesses] = useState<number>(142832);

  // Live Metrics
  const [p95Latency, setP95Latency] = useState<number>(124);
  const [errorRate, setErrorRate] = useState<number>(0.04);
  const [ordersPerSecond, setOrdersPerSecond] = useState<number>(342);
  const [ordersReserved, setOrdersReserved] = useState<number>(18490);

  // Chart
  const [timeWindow, setTimeWindow] = useState<'5m' | '15m' | '1h' | '6h'>('15m');
  
  // Pre-seed realistic time series
  const [metricHistory, setMetricHistory] = useState<MetricPoint[]>(() => {
    const pts: MetricPoint[] = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const t = new Date(now - i * 37500);
      const timeStr = t.toISOString().substring(11, 19);
      // Slight smooth variations around 65ms (p50) and 124ms (p95)
      const p50 = Math.round(62 + Math.sin(i * 0.4) * 5 + (Math.random() * 4 - 2));
      const p95 = Math.round(122 + Math.cos(i * 0.5) * 8 + (Math.random() * 6 - 3));
      pts.push({ time: timeStr, timestamp: t.getTime(), p50, p95 });
    }
    return pts;
  });

  // Topology Nodes
  const [nodes, setNodes] = useState<TopologyNode[]>(INITIAL_NODES);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  // Chaos Toxic State
  const [activeToxic, setActiveToxic] = useState<{
    type: string;
    target: string;
    latencyMs: number;
    jitterMs: number;
    running: boolean;
    remainingSeconds: number;
  } | null>(null);

  const [experiments, setExperiments] = useState<ChaosExperiment[]>(INITIAL_EXPERIMENTS);

  // Modals & Drawers
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState<boolean>(false);
  const [isToxiproxyModalOpen, setIsToxiproxyModalOpen] = useState<boolean>(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);

  // Terminal & Alerts
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>(INITIAL_LOGS);
  const [alerts, setAlerts] = useState<GuardrailAlert[]>([
    {
      id: 'alert-1',
      timestamp: '14:58:12',
      type: 'info',
      title: 'Automated Canary Check Passed',
      description: 'Zero divergence observed across all 8 fulfillment replicas in cluster/prod-east-order-cluster.',
      read: true,
    },
    {
      id: 'alert-2',
      timestamp: '14:52:05',
      type: 'warning',
      title: 'Postgres Outbox Flush Drift (+4ms)',
      description: 'Temporary lock contention on outbox partition pg-cluster-01 cleared automatically within 1.2s.',
      read: false,
    },
  ]);

  const sloThresholdMs = 500;
  const guardrailsActive = 12;
  const totalGuardrails = 12;

  // Add terminal log helper
  const addLog = (service: string, level: 'info' | 'warn' | 'error' | 'chaos', message: string) => {
    const now = new Date();
    const ts = now.toISOString().substring(11, 23);
    setTerminalLogs((prev) => [
      ...prev.slice(-99),
      { id: Math.random().toString(36).substring(2, 9), timestamp: ts, service, level, message },
    ]);
  };

  const clearTerminalLogs = () => setTerminalLogs([]);

  const markAlertAsRead = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  };

  const dismissAllAlerts = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  };

  const unreadAlertCount = alerts.filter((a) => !a.read).length;

  // Real-time background simulation clock (1 second tick)
  const isToxicActiveRef = useRef(activeToxic);
  isToxicActiveRef.current = activeToxic;

  useEffect(() => {
    const timer = setInterval(() => {
      // 1. Advance traffic counters if background traffic is enabled
      if (backgroundTraffic) {
        const delta = requestsPerSecond;
        const failed = activeToxic?.running ? Math.floor(delta * (errorRate / 100) + Math.random() * 2) : 0;
        const success = Math.max(0, delta - failed);
        
        setTotalAttempts((prev) => prev + delta);
        setTotalSuccesses((prev) => prev + success);
        setOrdersReserved((prev) => prev + (Math.random() > 0.4 ? 1 : 0));
        
        // Orders per second slight fluctuation around baseline + rps factor
        setOrdersPerSecond(Math.round(330 + requestsPerSecond * 1.5 + (Math.random() * 8 - 4)));
      }

      // 2. Toxic countdown & metrics adjustment
      if (activeToxic?.running) {
        const nextRemaining = activeToxic.remainingSeconds - 1;
        if (nextRemaining <= 0) {
          // Auto-complete toxic
          stopActiveToxic();
          addLog('toxiproxy', 'info', `Chaos experiment completed. Toxic '${activeToxic.type}' removed. System restored to baseline.`);
        } else {
          setActiveToxic((prev) => prev ? { ...prev, remainingSeconds: nextRemaining } : null);
          
          // Elevated metrics under chaos
          const baseChaosP95 = 124 + activeToxic.latencyMs;
          const jitter = (Math.random() * 2 - 1) * (activeToxic.jitterMs || 30);
          const currentP95 = Math.round(baseChaosP95 + jitter);
          setP95Latency(currentP95);
          
          const currentErr = Number((0.04 + (activeToxic.latencyMs > 400 ? 0.35 : 0.08) + Math.random() * 0.05).toFixed(2));
          setErrorRate(currentErr);

          // Update chart point
          const now = new Date();
          const timeStr = now.toISOString().substring(11, 19);
          setMetricHistory((prev) => {
            const next = [...prev.slice(1)];
            next.push({
              time: timeStr,
              timestamp: now.getTime(),
              p50: Math.round(65 + activeToxic.latencyMs * 0.4),
              p95: currentP95,
            });
            return next;
          });

          // Check SLO breach
          if (currentP95 >= sloThresholdMs) {
            if (Math.random() > 0.7) {
              addLog('guardrails', 'warn', `CRITICAL: P95 latency (${currentP95}ms) breached SLO threshold (${sloThresholdMs}ms)`);
            }
          }
        }
      } else {
        // Nominal steady state: smoothly glide back towards baseline 124ms
        setP95Latency((prev) => {
          if (prev > 130) return Math.round(prev - (prev - 124) * 0.35);
          return Math.round(124 + (Math.random() * 4 - 2));
        });
        setErrorRate((prev) => {
          if (prev > 0.06) return Number((prev - 0.05).toFixed(2));
          return 0.04;
        });

        // Nominal chart point
        const now = new Date();
        const timeStr = now.toISOString().substring(11, 19);
        setMetricHistory((prev) => {
          const next = [...prev.slice(1)];
          next.push({
            time: timeStr,
            timestamp: now.getTime(),
            p50: Math.round(65 + (Math.random() * 4 - 2)),
            p95: Math.round(124 + (Math.random() * 6 - 3)),
          });
          return next;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [backgroundTraffic, requestsPerSecond, activeToxic, errorRate]);

  // Inject toxic function
  const injectToxic = (
    targetId: string,
    type: string,
    latencyMs: number,
    jitterMs: number = 40,
    duration: number = 45
  ) => {
    setActiveToxic({
      type,
      target: targetId,
      latencyMs,
      jitterMs,
      running: true,
      remainingSeconds: duration,
    });

    // Update topology node
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === 'toxiproxy') {
          return {
            ...n,
            status: 'chaos',
            stat: 'ACTIVE',
            subtitle: `+${latencyMs}ms INJECTED`,
          };
        }
        if (n.id === targetId && n.id !== 'toxiproxy') {
          return {
            ...n,
            status: 'warning',
            latencyMs: n.latencyMs + latencyMs,
          };
        }
        return n;
      })
    );

    addLog('toxiproxy', 'chaos', `ACTION: Injected ${type} toxic on target=${targetId} latency=+${latencyMs}ms jitter=±${jitterMs}ms duration=${duration}s`);
    
    // Alert
    setAlerts((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString().substring(11, 19),
        type: latencyMs > 350 ? 'danger' : 'warning',
        title: `Chaos Fault Active: ${type.toUpperCase()}`,
        description: `Toxiproxy is actively injecting +${latencyMs}ms latency into ${targetId}. Watchdog guardrails monitoring blast radius.`,
        read: false,
      },
      ...prev,
    ]);
  };

  // Stop active toxic (rollback)
  const stopActiveToxic = () => {
    setActiveToxic(null);
    setNodes(INITIAL_NODES);
    addLog('toxiproxy', 'info', 'ROLLBACK: All toxics cleared on Toxiproxy. Port :8474 in bypass mode.');
  };

  // Emergency Stop Trigger
  const emergencyStop = () => {
    setActiveToxic(null);
    setNodes(INITIAL_NODES);
    setP95Latency(124);
    setErrorRate(0.04);
    addLog('guardrails', 'error', 'EMERGENCY STOP TRIGGERED: Instant kill signal dispatched! All chaos proxies bypassed and circuit breakers forced closed.');
    
    setAlerts((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString().substring(11, 19),
        type: 'danger',
        title: 'EMERGENCY STOP EXECUTED',
        description: 'Operator pressed Emergency Stop. All active chaos experiments have been aborted and traffic reverted to baseline.',
        read: false,
      },
      ...prev,
    ]);
  };

  return (
    <ChaosContext.Provider
      value={{
        currentScreen,
        setCurrentScreen,
        currentCluster,
        setCurrentCluster,
        clusters,
        backgroundTraffic,
        setBackgroundTraffic,
        requestsPerSecond,
        setRequestsPerSecond,
        totalAttempts,
        totalSuccesses,
        p95Latency,
        errorRate,
        ordersPerSecond,
        ordersReserved,
        timeWindow,
        setTimeWindow,
        metricHistory,
        nodes,
        selectedNode,
        setSelectedNode,
        activeToxic,
        experiments,
        injectToxic,
        stopActiveToxic,
        emergencyStop,
        isEmergencyModalOpen,
        setIsEmergencyModalOpen,
        isToxiproxyModalOpen,
        setIsToxiproxyModalOpen,
        isTerminalOpen,
        setIsTerminalOpen,
        isNotificationsOpen,
        setIsNotificationsOpen,
        terminalLogs,
        clearTerminalLogs,
        alerts,
        markAlertAsRead,
        dismissAllAlerts,
        unreadAlertCount,
        guardrailsActive,
        totalGuardrails,
        sloThresholdMs,
      }}
    >
      {children}
    </ChaosContext.Provider>
  );
};

export const useChaos = () => {
  const context = useContext(ChaosContext);
  if (!context) {
    throw new Error('useChaos must be used within a ChaosProvider');
  }
  return context;
};
