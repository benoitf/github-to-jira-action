export class ThrottleQueue {
  private intervalMs: number;
  private lastCallTime = 0;
  private queue: (() => void)[] = [];
  private isProcessing = false;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  public throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    const now = Date.now();
    const wait = Math.max(0, this.lastCallTime + this.intervalMs - now);

    setTimeout(() => {
      this.lastCallTime = Date.now();
      const next = this.queue.shift();
      if (next) {
        next();
      }
      this.processQueue();
    }, wait);
  }
}
