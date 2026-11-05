import { env } from "@/config/env";
import { logger } from "@/lib/logger";

// Document-processing job queue — see docs/document-processing.md §Queue.
//
// Upload never waits for OCR/AI: the upload request only persists a QUEUED
// DocumentIntelligence row + AiProcessingJob and enqueues a small message
// (ids only — never document content). Today messages are consumed by an
// in-process, serial worker. The ProcessingQueue interface is the seam for a
// production Cloud Storage event → Pub/Sub → Cloud Run worker deployment:
// a PubSubProcessingQueue would publish the same message and the worker
// would invoke the same handler.
//
// Modes: "auto" (default) runs jobs in the background right after enqueue;
// "manual" only queues them until drain() is called (used by the test suite
// so background work never interleaves with unrelated tests).

export interface ProcessingJobMessage {
  intelligenceId: string;
  jobId: string;
  requestId: string;
}

export type ProcessingHandler = (message: ProcessingJobMessage) => Promise<void>;

export interface ProcessingQueue {
  readonly name: string;
  enqueue(message: ProcessingJobMessage): void;
  /** Processes everything queued so far (and anything queued meanwhile). */
  drain(): Promise<void>;
  pendingCount(): number;
}

class InProcessProcessingQueue implements ProcessingQueue {
  readonly name = "in-process (single worker)";
  private pending: ProcessingJobMessage[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly mode: "auto" | "manual",
    private readonly handler: () => ProcessingHandler | undefined,
  ) {}

  enqueue(message: ProcessingJobMessage) {
    this.pending.push(message);
    if (this.mode === "auto") setImmediate(() => void this.pump());
  }

  pendingCount() {
    return this.pending.length;
  }

  private pump(): Promise<void> {
    if (!this.running) {
      this.running = (async () => {
        try {
          while (this.pending.length) {
            const message = this.pending.shift()!;
            const handle = this.handler();
            if (!handle) throw new Error("No document-processing handler is registered.");
            try {
              await handle(message);
            } catch (err) {
              // The handler records failures itself; this is a last resort.
              // Only ids are logged — never document content.
              logger.error({ jobId: message.jobId, err: (err as Error).message }, "document processing job crashed");
            }
          }
        } finally {
          this.running = null;
        }
      })();
    }
    return this.running;
  }

  async drain() {
    while (this.pending.length || this.running) await this.pump();
  }
}

let handler: ProcessingHandler | undefined;
let queue: ProcessingQueue | undefined;

export function registerProcessingHandler(h: ProcessingHandler) {
  handler = h;
}

export function getProcessingQueue(): ProcessingQueue {
  if (!queue) queue = new InProcessProcessingQueue(env.DOCUMENT_PROCESSING_MODE, () => handler);
  return queue;
}
