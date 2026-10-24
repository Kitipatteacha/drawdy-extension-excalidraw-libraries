let queue: Promise<unknown> = Promise.resolve();

export function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch(() => {});
}
