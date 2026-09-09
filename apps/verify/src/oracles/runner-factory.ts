import { DockerRunner } from "./docker-runner.js";
import { K8sJobRunner } from "./k8s-job-runner.js";
import type { JobRunner } from "./patch-oracle.js";
import { parseBytes, parseCpus } from "./quantity.js";

export const RUNNER_KINDS = ["k8s", "docker", "none"] as const;
export type RunnerKind = (typeof RUNNER_KINDS)[number];

export type RunnerConfig = {
  RUNNER_KIND: RunnerKind;
  RUNNER_CPU: string;
  RUNNER_MEMORY: string;
  RUNNER_NAMESPACE: string;
  RUNNER_SERVICE_ACCOUNT: string;
  RUNNER_LABEL: string;
  RUNNER_NODE_SELECTOR: string;
  RUNNER_TOLERATIONS: string;
  DOCKER_HOST: string;
};

/** Refuses every code task with a note that says how to enable a runner. */
export class NoRunner implements JobRunner {
  async run(): Promise<never> {
    throw new Error("no code runner configured (RUNNER_KIND=none): run on Kubernetes (RUNNER_KIND=k8s) or mount the Docker socket and set RUNNER_KIND=docker");
  }
}

/** One Docker host setting for both transports: unix:///var/run/docker.sock or tcp://host:port. */
function dockerTransport(host: string): { socketPath?: string; host?: string; port?: number } {
  if (host.startsWith("unix://")) return { socketPath: host.slice("unix://".length) };
  if (host.startsWith("tcp://")) {
    const u = new URL(host);
    return { host: u.hostname, port: u.port ? Number(u.port) : 2375 };
  }
  return { socketPath: host };
}

const STRATEGIES: Record<RunnerKind, (cfg: RunnerConfig) => JobRunner> = {
  k8s: (cfg) =>
    new K8sJobRunner({
      namespace: cfg.RUNNER_NAMESPACE,
      serviceAccount: cfg.RUNNER_SERVICE_ACCOUNT,
      runnerLabel: cfg.RUNNER_LABEL,
      cpu: cfg.RUNNER_CPU,
      memory: cfg.RUNNER_MEMORY,
      nodeSelector: JSON.parse(cfg.RUNNER_NODE_SELECTOR) as Record<string, string>,
      tolerations: JSON.parse(cfg.RUNNER_TOLERATIONS) as never[],
    }),
  docker: (cfg) => new DockerRunner({ ...dockerTransport(cfg.DOCKER_HOST), cpus: parseCpus(cfg.RUNNER_CPU), memoryBytes: parseBytes(cfg.RUNNER_MEMORY) }),
  none: () => new NoRunner(),
};

/** Strategy registry: the deployment picks the runner; the oracle never knows. */
export function createRunner(cfg: RunnerConfig): JobRunner {
  return STRATEGIES[cfg.RUNNER_KIND](cfg);
}
