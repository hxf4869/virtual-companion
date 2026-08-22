// H5-HARDEN (§21.7): guards over the static shell. These read the real
// entry files so a regression (dropped noindex, re-added analytics snippet,
// dynamic share-card content) fails CI instead of reaching a public page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 以 frontend/ 为工作目录运行（pnpm --dir frontend），按 cwd 解析
// 而不是 import.meta.url（在 vitest 管线下不可靠）。
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const robots = readFileSync(join(process.cwd(), "public", "robots.txt"), "utf8");

describe("H5 上线加固静态壳（§21.7）", () => {
  it("入口 HTML 禁止搜索收录且不外泄 Referer", () => {
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  it("分享卡片只含静态文案，不含动态绑定或聊天占位", () => {
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).not.toMatch(/og:(title|description)" content="[^"]*\{\{/);
  });

  it("robots.txt 对全站 Disallow", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /");
  });

  it("入口 HTML 不引入任何监控/统计脚本", () => {
    expect(html).not.toMatch(/gtag|analytics|hm\.baidu|sentry/i);
  });
});

describe("S0-18 统一导航守卫入口", () => {
  it("main.ts 安装拦截器并在会话解析后回跳", () => {
    const main = readFileSync(join(process.cwd(), "src", "main.ts"), "utf8");
    expect(main).toContain("attachAppNavigationGuards");
    expect(main).toContain("bootstrapAuthSession");
  });
});

describe("S0-06 同源会话：token 不进 localStorage", () => {
  it("auth store 源码不把 access/refresh token 写入 localStorage", () => {
    const authStore = readFileSync(
      join(process.cwd(), "src", "stores", "auth.ts"),
      "utf8",
    );
    expect(authStore).toMatch(/NO token or identity field is ever written to localStorage/);
    expect(authStore).not.toMatch(/localStorage\.setItem/);
  });
});
