import Docker from "dockerode";
import { randomBytes } from "node:crypto";
import { pack } from "tar-stream";
import type { JobRunner, RunnerReport } from "./patch-oracle.js";

export type DockerRunnerOptions = {
  /** Unix socket of the Docker daemon (or set `host`/`port` for TCP). */
  socketPath?: string;
  host?: string;
  port?: number;
  cpus: number;
  memoryBytes: number;
  /** Pull the runner image when the daemon does not have it (public registries). */
  pullMissing?: boolean;
};

const PATCH_DIR = "patch";

/**
 * The Docker Compose counterpart of K8sJobRunner: one patch runs in a sibling
 * container created from the spec's runner image — no network, all
 * capabilities dropped, no privilege escalation, memory/CPU/pid limits, a
 * tmpfs workspace, a hard deadline — with the patch and the hidden files
 * delivered as an archive under /patch before the container starts. The
 * runner prints its JSON report as the LAST stdout line; the container is
 * removed afterwards whatever happened. Same contract, same env, same
 * report shape as the Kubernetes runner, so a task spec is portable.
 */
export class DockerRunner implements JobRunner {
  private readonly docker: Docker;

  constructor(private readonly o: DockerRunnerOptions, docker?: Docker) {
    this.docker = docker ?? new Docker(o.host ? { host: o.host, port: o.port ?? 2375 } : { socketPath: o.socketPath ?? "/var/run/docker.sock" });
  }

  async run({ spec, patch, ctx }: Parameters<JobRunner["run"]>[0]): Promise<RunnerReport> {
    const name = `benchme-runner-${ctx.taskId}-${randomBytes(4).toString("hex")}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 60);
    await this.ensureImage(spec.runnerImage);
    const hidden = Object.entries(spec.hiddenFiles);
    const files: Record<string, string> = {
      "submission.patch": patch.toString("utf8"),
      "hidden-manifest.json": JSON.stringify(hidden.map(([path], i) => ({ key: `hidden-${i}`, path }))),
    };
    hidden.forEach(([, content], i) => (files[`hidden-${i}`] = content));

    const container = await this.docker.createContainer({
      name,
      Image: spec.runnerImage,
      // Same semantics as the Kubernetes `command:` — replaces the image's
      // entrypoint (a Cmd would only be appended to it as arguments).
      ...(spec.runnerCommand ? { Entrypoint: spec.runnerCommand, Cmd: [] } : {}),
      User: "1001:1001",
      Env: [
        `PATCH_FILE=/${PATCH_DIR}/submission.patch`,
        `HIDDEN_MANIFEST=/${PATCH_DIR}/hidden-manifest.json`,
        `HIDDEN_DIR=/${PATCH_DIR}`,
        `BASE_SHA=${spec.baseSha}`,
        `RUN_LINT=${String(spec.lint)}`,
        `RUN_TYPECHECK=${String(spec.typecheck)}`,
      ],
      Labels: { "app.kubernetes.io/part-of": "benchme", "benchme.dev/role": "runner", "benchme.dev/task": ctx.taskId },
      HostConfig: {
        NetworkMode: "none",
        Memory: this.o.memoryBytes,
        MemorySwap: this.o.memoryBytes,
        NanoCpus: Math.round(this.o.cpus * 1e9),
        PidsLimit: 1024,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        // Docker mounts tmpfs noexec by default; the workspace must run the
        // repo's own binaries (vitest, eslint, tsc) — the emptyDir does too.
        Tmpfs: { "/work": "rw,exec,nosuid,nodev,size=2g,uid=1001,gid=1001", "/tmp": "rw,nosuid,nodev,size=512m,uid=1001,gid=1001" },
        AutoRemove: false,
      },
    });
    try {
      await container.putArchive(await tarOf(files), { path: "/" });
      await container.start();
      const finished = await Promise.race([
        container.wait().then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), spec.timeoutSeconds * 1000)),
      ]);
      if (!finished) {
        await container.kill().catch(() => undefined);
        throw new Error(`runner ${name} did not finish within ${spec.timeoutSeconds}s`);
      }
      const raw = (await container.logs({ stdout: true, stderr: false, follow: false })) as unknown as Buffer;
      const last = demuxStdout(raw).trim().split("\n").filter(Boolean).at(-1) ?? "";
      try {
        const parsed = JSON.parse(last) as RunnerReport;
        if (typeof parsed.applied !== "boolean" || !Array.isArray(parsed.tests)) throw new Error("bad shape");
        return parsed;
      } catch {
        return { applied: false, tests: [], error: `runner produced no report (last line: ${last.slice(0, 200)})` };
      }
    } finally {
      await container.remove({ force: true, v: true }).catch(() => undefined);
    }
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404 || this.o.pullMissing === false) throw err;
    }
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => this.docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve())));
  }
}

/**
 * A tar archive with every file under /patch, owned by the runner user. The
 * packer is a stream: read it to the end AFTER finalize — collecting "data"
 * synchronously yields an empty archive that Docker extracts to nothing.
 */
async function tarOf(files: Record<string, string>): Promise<Buffer> {
  const p = pack();
  p.entry({ name: `${PATCH_DIR}/`, type: "directory", mode: 0o755, uid: 1001, gid: 1001 });
  for (const [name, content] of Object.entries(files)) p.entry({ name: `${PATCH_DIR}/${name}`, mode: 0o644, uid: 1001, gid: 1001 }, content);
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const c of p) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Container logs without a TTY arrive multiplexed: 8-byte frame headers
 * (stream type, 3 reserved bytes, big-endian payload size) before each chunk.
 * Keep the stdout frames (type 1) and drop the rest.
 */
export function demuxStdout(raw: Buffer): string {
  const out: Buffer[] = [];
  let i = 0;
  while (i + 8 <= raw.length) {
    const type = raw[i];
    const size = raw.readUInt32BE(i + 4);
    const payload = raw.subarray(i + 8, i + 8 + size);
    if (type === 1) out.push(payload);
    i += 8 + size;
  }
  // A daemon configured with a TTY returns plain text; fall back to it.
  return out.length || raw.length === 0 ? Buffer.concat(out).toString("utf8") : raw.toString("utf8");
}
