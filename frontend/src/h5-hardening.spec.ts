// H5-HARDEN (§21.7): guards over the static shell. These read the real
// entry files so a regression (dropped noindex, re-added analytics snippet,
// dynamic share-card content) fails CI instead of reaching a public page.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 以 frontend/ 为工作目录运行（pnpm --dir frontend），按 cwd 解析
// 而不是 import.meta.url（在 vitest 管线下不可靠）。
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const robots = readFileSync(join(process.cwd(), "public", "robots.txt"), "utf8");

function collectVueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectVueFiles(path);
    return entry.isFile() && entry.name.endsWith(".vue") ? [path] : [];
  });
}

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

  // DOGFOOD-09（ADR-0006 §1.4）：字体放大是双端验收项，入口壳禁止
  // 重新引入 user-scalable=no / maximum-scale / minimum-scale。
  it("viewport 不禁用用户缩放", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toMatch(/maximum-scale|minimum-scale/);
  });

  it("html 根元素声明页面语言 zh-CN", () => {
    expect(html).toMatch(/<html[^>]*\blang="zh-CN"/);
  });
});

describe("S0-18 统一导航守卫入口", () => {
  it("main.ts 安装拦截器并在会话解析后回跳", () => {
    const main = readFileSync(join(process.cwd(), "src", "main.ts"), "utf8");
    expect(main).toContain("attachAppNavigationGuards");
    expect(main).toContain("bootstrapAuthSession");
  });

  it("业务页面不把 uni 页面路径直接交给浏览器实体路由", () => {
    for (const path of collectVueFiles(join(process.cwd(), "src", "pages"))) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/location\.href\s*=\s*url\s*;/);
    }
  });

  it("页面入场动画结束后不保留 transform，固定弹层仍以视口定位", () => {
    const baseCss = readFileSync(
      join(process.cwd(), "src", "design-system", "base.css"),
      "utf8",
    );
    expect(baseCss).toContain(
      "animation: vc-loom-settle var(--vc-motion-base) var(--vc-ease-out) backwards;",
    );
    expect(baseCss).not.toContain(
      "animation: vc-loom-settle var(--vc-motion-base) var(--vc-ease-out) both;",
    );
    const settleKeyframes = baseCss.match(
      /@keyframes vc-loom-settle\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(settleKeyframes).toBeTruthy();
    expect(settleKeyframes).not.toContain("opacity");
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
