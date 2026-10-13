import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('port')),
      );
    });
  });
}

async function waitForReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('redis-server did not start')), 5000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Starts a throwaway redis-server for the test run (no persistence). To use an existing server
 * instead (e.g. a CI service container) set TEST_REDIS_URL and TEST_REDIS_ALLOW_FLUSH=1.
 */
export default async function setup(project: TestProject) {
  if (process.env.TEST_REDIS_URL) {
    // Tests FLUSH the databases they use. Never point them at a Redis holding real data.
    if (process.env.TEST_REDIS_ALLOW_FLUSH !== '1') {
      throw new Error(
        'TEST_REDIS_URL is set but TEST_REDIS_ALLOW_FLUSH=1 is not: tests flush Redis databases, so ' +
          'they only use an external Redis that is explicitly marked disposable.',
      );
    }
    project.provide('redisUrl', process.env.TEST_REDIS_URL);
    return;
  }
  const port = await freePort();
  const proc = spawn(
    'redis-server',
    [
      ...['--port', String(port), '--bind', '127.0.0.1', '--databases', '64'],
      ...['--save', '', '--appendonly', 'no'],
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForReady(proc);
  project.provide('redisUrl', `redis://127.0.0.1:${port}`);
  return async () => {
    proc.kill('SIGTERM');
  };
}
