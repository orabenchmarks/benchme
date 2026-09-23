/**
 * A four-line concurrency gate, in-tree rather than a dependency: a ranker
 * fans one request out per candidate, and an unbounded fan-out is how a 25-item
 * /ask turns into a provider rate-limit storm (which then degrades the answer).
 */

/** Runs `task` when a slot is free; resolves/rejects with the task's own outcome. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): Limiter {
  const max = Math.max(1, Math.floor(concurrency));
  const waiting: (() => void)[] = [];
  let active = 0;

  // Released in `finally`, so a rejected task frees its slot too — otherwise one
  // upstream failure would wedge every remaining candidate behind it.
  const release = (): void => {
    active--;
    waiting.shift()?.();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active++;
        void task().then(resolve, reject).finally(release);
      };
      if (active < max) start();
      else waiting.push(start);
    });
}
