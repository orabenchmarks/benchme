import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import type { JobRunner, RunnerReport } from "./patch-oracle.js";

export type K8sJobRunnerOptions = {
  namespace: string;
  /** ServiceAccount for runner pods (no API access; exists so RBAC can target it). */
  serviceAccount: string;
  /** Applied as a label so a NetworkPolicy can deny all egress to runner pods. */
  runnerLabel: string;
  cpu: string;
  memory: string;
  nodeSelector?: Record<string, string>;
  tolerations?: k8s.V1Toleration[];
};

/**
 * Executes a patch in an isolated Job: the spec's runner image, the patch
 * delivered through a ConfigMap mounted at /patch/submission.patch, no
 * network (NetworkPolicy on the runner label), hard resource limits and a
 * deadline. The runner prints its JSON report as the LAST line of stdout.
 */
export class K8sJobRunner implements JobRunner {
  private readonly batch: k8s.BatchV1Api;
  private readonly core: k8s.CoreV1Api;

  constructor(
    private readonly o: K8sJobRunnerOptions,
    kc = (() => {
      const c = new k8s.KubeConfig();
      c.loadFromDefault();
      return c;
    })(),
  ) {
    this.batch = kc.makeApiClient(k8s.BatchV1Api);
    this.core = kc.makeApiClient(k8s.CoreV1Api);
  }

  async run({ spec, patch, ctx }: Parameters<JobRunner["run"]>[0]): Promise<RunnerReport> {
    const name = `verify-${ctx.taskId}-${randomBytes(4).toString("hex")}`.slice(0, 60);
    const ns = this.o.namespace;
    // One ConfigMap carries the patch and the hidden files; keys cannot hold
    // "/" so paths are encoded and a manifest maps them back for the runner.
    const hidden = Object.entries(spec.hiddenFiles);
    const data: Record<string, string> = { "submission.patch": patch.toString("utf8"), "hidden-manifest.json": JSON.stringify(hidden.map(([path], i) => ({ key: `hidden-${i}`, path }))) };
    hidden.forEach(([, content], i) => (data[`hidden-${i}`] = content));
    await this.core.createNamespacedConfigMap({ namespace: ns, body: { metadata: { name, labels: { "app.kubernetes.io/part-of": "benchme", "benchme.dev/role": this.o.runnerLabel } }, data } });
    try {
      await this.batch.createNamespacedJob({
        namespace: ns,
        body: {
          metadata: { name, labels: { "app.kubernetes.io/part-of": "benchme", "benchme.dev/role": this.o.runnerLabel, "benchme.dev/task": ctx.taskId } },
          spec: {
            backoffLimit: 0,
            activeDeadlineSeconds: spec.timeoutSeconds,
            ttlSecondsAfterFinished: 300,
            template: {
              metadata: { labels: { "app.kubernetes.io/part-of": "benchme", "benchme.dev/role": this.o.runnerLabel } },
              spec: {
                restartPolicy: "Never",
                ...(this.o.nodeSelector && Object.keys(this.o.nodeSelector).length ? { nodeSelector: this.o.nodeSelector } : {}),
                ...(this.o.tolerations?.length ? { tolerations: this.o.tolerations } : {}),
                serviceAccountName: this.o.serviceAccount,
                automountServiceAccountToken: false,
                securityContext: { runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001, seccompProfile: { type: "RuntimeDefault" } },
                containers: [
                  {
                    name: "runner",
                    image: spec.runnerImage,
                    ...(spec.runnerCommand ? { command: spec.runnerCommand } : {}),
                    env: [
                      { name: "PATCH_FILE", value: "/patch/submission.patch" },
                      { name: "HIDDEN_MANIFEST", value: "/patch/hidden-manifest.json" },
                      { name: "HIDDEN_DIR", value: "/patch" },
                      { name: "BASE_SHA", value: spec.baseSha },
                      { name: "RUN_LINT", value: String(spec.lint) },
                      { name: "RUN_TYPECHECK", value: String(spec.typecheck) },
                    ],
                    resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: this.o.cpu, memory: this.o.memory } },
                    securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
                    volumeMounts: [
                      { name: "patch", mountPath: "/patch", readOnly: true },
                      { name: "work", mountPath: "/work" },
                    ],
                  },
                ],
                volumes: [
                  { name: "patch", configMap: { name } },
                  { name: "work", emptyDir: { sizeLimit: "2Gi" } },
                ],
              },
            },
          },
        },
      });
      const pod = await this.waitForPod(ns, name, spec.timeoutSeconds + 60);
      const logs = await this.core.readNamespacedPodLog({ namespace: ns, name: pod, container: "runner" });
      const last = logs.trim().split("\n").filter(Boolean).at(-1) ?? "";
      try {
        const parsed = JSON.parse(last) as RunnerReport;
        if (typeof parsed.applied !== "boolean" || !Array.isArray(parsed.tests)) throw new Error("bad shape");
        return parsed;
      } catch {
        return { applied: false, tests: [], error: `runner produced no report (last line: ${last.slice(0, 200)})` };
      }
    } finally {
      await this.batch.deleteNamespacedJob({ namespace: ns, name, propagationPolicy: "Background" }).catch(() => undefined);
      await this.core.deleteNamespacedConfigMap({ namespace: ns, name }).catch(() => undefined);
    }
  }

  private async waitForPod(ns: string, job: string, timeoutSeconds: number): Promise<string> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const pods = await this.core.listNamespacedPod({ namespace: ns, labelSelector: `job-name=${job}` });
      const pod = pods.items[0];
      const phase = pod?.status?.phase;
      if (pod?.metadata?.name && (phase === "Succeeded" || phase === "Failed")) return pod.metadata.name;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`runner job ${job} did not finish within ${timeoutSeconds}s`);
  }
}
