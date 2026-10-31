import { test as base, expect as baseExpect } from '@playwright/test';
export * from '@playwright/test';
// Auth UI assertions must allow the bounded Retry-After wait below to finish.
export const expect = baseExpect.configure({ timeout: 65000 });

// All browser journeys share a localhost IP. Honor the application's real auth
// budget instead of disabling it or letting unrelated tests exhaust each other.
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    const originalTimeout = testInfo.timeout;
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (
        request.method() !== 'POST' ||
        !/^\/api\/(auth\/(login|register)$|identity\/)/.test(path)
      ) {
        await route.fallback();
        return;
      }
      let response = await route.fetch();
      if (response.status() === 429 && (await response.json()).code === 'RATE_LIMIT') {
        const seconds = Number(response.headers()['retry-after']);
        if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) {
          testInfo.setTimeout(Math.max(testInfo.timeout, originalTimeout + 65000));
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
          response = await route.fetch();
        }
      }
      await route.fulfill({ response });
    });
    await use(context);
  },
});
