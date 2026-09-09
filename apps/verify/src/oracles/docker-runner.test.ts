import Docker from "dockerode";
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { DockerRunner, demuxStdout } from "./docker-runner.js";

const SOCK = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const IMAGE = "busybox:1.36";
const base = { kind: "patch" as const, runnerImage: IMAGE, baseSha: "0000000", hiddenFiles: { "tests/hidden.txt": "hidden content" }, requiredTests: [], lint: false, typecheck: false, timeoutSeconds: 60 };
const ctx = { workspaceId: "ws_docker_runner_test", taskId: "docker-runner-test" };
const sh = (script: string) => ["sh", "-c", script];

describe("demuxStdout", () => {
  it("keeps stdout frames and drops stderr frames", () => {
    const frame = (type: number, s: string) => Buffer.concat([Buffer.from([type, 0, 0, 0, 0, 0, 0, s.length]), Buffer.from(s)]);
    expect(demuxStdout(Buffer.concat([frame(1, "a\n"), frame(2, "err\n"), frame(1, "b\n")]))).toBe("a\nb\n");
  });
  it("passes plain text through", () => {
    expect(demuxStdout(Buffer.from("plain"))).toBe("plain");
  });
});

// Real daemon, no mocks: skipped where there is no Docker socket.
describe.skipIf(!existsSync(SOCK))("DockerRunner (real Docker daemon)", () => {
  const docker = new Docker({ socketPath: SOCK });
  const runner = new DockerRunner({ socketPath: SOCK, cpus: 1, memoryBytes: 256 * 1024 * 1024 }, docker);
  const leftovers = async () => docker.listContainers({ all: true, filters: { label: [`benchme.dev/task=${ctx.taskId}`] } });
  afterAll(async () => {
    for (const c of await leftovers()) await docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined);
  });

  it("delivers the patch and hidden files, runs as the runner user with an executable workspace, and returns the last-line report", async () => {
    const spec = {
      ...base,
      runnerCommand: sh(`[ "$(cat "$PATCH_FILE")" = "diff --git a/x b/x" ] || exit 3; [ "$(cat "$HIDDEN_DIR/hidden-0")" = "hidden content" ] || exit 4; grep -q '"path":"tests/hidden.txt"' "$HIDDEN_MANIFEST" || exit 5; [ "$(id -u)" = 1001 ] || exit 6; touch /work/w /tmp/t || exit 7; cp /bin/busybox /work/busybox && /work/busybox true || exit 8; echo noise on stdout; echo '{"applied":true,"tests":[{"id":"t1","ok":true}],"lint":true}'`),
    };
    const r = await runner.run({ spec, patch: Buffer.from("diff --git a/x b/x"), ctx });
    expect(r, r.error).toEqual({ applied: true, tests: [{ id: "t1", ok: true }], lint: true });
    expect(await leftovers()).toHaveLength(0);
  }, 120_000);

  it("runs without network", async () => {
    const spec = { ...base, runnerCommand: sh(`if wget -q -T 3 -O /dev/null http://example.com 2>/dev/null; then echo '{"applied":true,"tests":[]}'; else echo '{"applied":false,"tests":[],"error":"offline"}'; fi`) };
    const r = await runner.run({ spec, patch: Buffer.from("diff --git a b"), ctx });
    expect(r.error).toBe("offline");
  }, 120_000);

  it("reports a runner that prints no report", async () => {
    const spec = { ...base, runnerCommand: sh("echo just words") };
    const r = await runner.run({ spec, patch: Buffer.from("diff --git a b"), ctx });
    expect(r.applied).toBe(false);
    expect(r.error).toMatch(/no report/);
  }, 120_000);

  it("kills a runner past its deadline and removes the container", async () => {
    const spec = { ...base, timeoutSeconds: 2, runnerCommand: sh("sleep 30") };
    await expect(runner.run({ spec, patch: Buffer.from("diff --git a b"), ctx })).rejects.toThrow(/did not finish within 2s/);
    expect(await leftovers()).toHaveLength(0);
  }, 120_000);
});
