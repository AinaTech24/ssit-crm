/**
 * BullMQ queue setup. We use Redis-backed queues for:
 *   - workflow.runner             — execute one step of a workflow run
 *   - outbox.poller               — internal scheduler that polls events_outbox
 *   - segment.materializer        — re-materialize dynamic segments
 *   - vartify.template_sync          — periodic sync of WhatsApp template approval status
 *   - comm.dispatch.{channel}     — channel-specific send queues (rate-limit per tenant)
 *   - master.scheduler            — cron-style triggers fire here
 *
 * Per-tenant rate limiting: BullMQ supports `limiter: { max, duration }` per
 * worker. We give each tenant their own queue suffix for sensitive
 * workloads to prevent noisy-neighbor (e.g., a tenant's 50k-message broadcast
 * starving another tenant's transactional comms).
 */

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

let connection: ConnectionOptions | undefined;
let redisClient: IORedis | undefined;

export function redis() {
  if (!redisClient) {
    redisClient = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = { connection: redis() } as any;
  }
  return connection!;
}

const queues = new Map<string, Queue>();

export function queue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: redis(),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 604_800 },
        },
      })
    );
  }
  return queues.get(name)!;
}

export const Q = {
  workflowRunner: () => queue("workflow.runner"),
  outboxPoller: () => queue("outbox.poller"),
  segmentMaterializer: () => queue("segment.materializer"),
  vartifyTemplateSync: () => queue("vartify.template_sync"),
  masterScheduler: () => queue("master.scheduler"),
  commDispatch: (channel: string, tenantId: string) => queue(`comm.dispatch.${channel}.${tenantId}`),
  campaignDispatch: (tenantId: string) => queue(`campaign.dispatch.${tenantId}`),
  // Heavy RTA file parse — runs in the WORKER (concurrency 1) so a large CAMS /
  // KFintech master never blocks the web event loop or OOM-crashes the web
  // server. The job payload carries the zip password (Redis-only, removed on
  // complete); the file itself stays in S3 and is fetched by the worker.
  rtaImport: () => queue("rta.import"),
};
