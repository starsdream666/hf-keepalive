import { handleApi } from './router';
import { runScheduler } from './scheduler';
import type { Env } from './types';

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url);

    const apiRes = await handleApi(req, env, url);
    if (apiRes) return apiRes;

    // 把所有非 /api/* 请求交给静态资源（前端 SPA）
    return env.ASSETS.fetch(req);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runScheduler(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
