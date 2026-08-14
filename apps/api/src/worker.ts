import 'dotenv/config';
import { prisma } from '@retaillink/database';
import { runBillingBatch } from './billing-worker.js';
import { runWebhookBatch } from './webhook-worker.js';

function numberEnv(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function validateWorkerConfig() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    if (!key || Buffer.from(key, 'base64').length !== 32) {
      throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production.');
    }
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ level: 'info', message: 'Worker shutdown started', signal }));
  await prisma.$disconnect().catch(() => undefined);
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

async function main() {
  validateWorkerConfig();
  const pollMs = numberEnv('WORKER_POLL_MS', numberEnv('WEBHOOK_WORKER_POLL_MS', 5000, 250), 250);
  console.info(JSON.stringify({ level: 'info', message: 'Retaillink worker started', poll_ms: pollMs }));

  while (!stopping) {
    try {
      const [webhooks, billing] = await Promise.all([runWebhookBatch(), runBillingBatch()]);
      const processed = webhooks + billing;
      if (processed) {
        console.info(JSON.stringify({ level: 'info', message: 'Worker batch completed', webhook_jobs: webhooks, billing_jobs: billing }));
      } else {
        await sleep(pollMs);
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Worker batch failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      await sleep(pollMs);
    }
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify({ level: 'fatal', message: error instanceof Error ? error.message : String(error) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
