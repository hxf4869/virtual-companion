// 生产导航模型行为测试（Phase 0 行为冻结）：
// 1) 覆盖 pages.json 全部路由，不多不少；
// 2) 外壳/角色可见性与 nav-guard 的 PageClass 对账；
// 3) 深链 query 参数与页面实际消费一致；
// 4) 四入口底栏与"我的"分组满足目标 IA。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { canEnterAdminPage, canEnterOpsPage, classifyPage } from "@/domain/nav-guard";

import {
  CONSUMER_TABS,
  hasBottomNav,
  isOperatorRole,
  isVisibleToRole,
  ME_GROUP_ORDER,
  pageClassOf,
  routeSpecOf,
  ROUTES,
  type RouteSpec,
} from "./navigation";

// vitest 进程 cwd 固定为 frontend 根目录；pages.json 是路由注册真源。
// vitest 进程 cwd 固定为 frontend 根目录；pages.json 是路由注册真源，
// 文件是带 // 注释的 JSONC（页内值不含 //），剥掉注释后解析。
const rawPagesJson = readFileSync(
  resolve(process.cwd(), "src/pages.json"),
  "utf8",
);
const pagesJson = JSON.parse(rawPagesJson.replace(/\/\/.*$/gm, "")) as {
  pages: Array<{ path: string }>;
};

const PAGE_PATHS = pagesJson.pages.map(
  (page) => `/${page.path}`,
) as readonly string[];

function specOf(path: string): RouteSpec {
  const spec = routeSpecOf(path);
  if (!spec) throw new Error(`missing RouteSpec for ${path}`);
  return spec;
}

describe("navigation model coverage", () => {
  it("covers exactly the routes declared in pages.json", () => {
    expect(PAGE_PATHS).toHaveLength(20);
    expect(new Set(PAGE_PATHS).size).toBe(PAGE_PATHS.length);
    expect(ROUTES.map((spec) => spec.path).sort()).toEqual(
      [...PAGE_PATHS].sort(),
    );
  });

  it("resolves specs with query strings stripped", () => {
    const spec = routeSpecOf(
      "/pages/chat/chat?relationshipId=rel-1&conversationId=42",
    );
    expect(spec?.path).toBe("/pages/chat/chat");
    expect(routeSpecOf("/pages/nope/nope")).toBeNull();
  });

  it("every route has a title, shell and IA section", () => {
    for (const spec of ROUTES) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.shell).toBeTruthy();
      expect(spec.section).toBeTruthy();
    }
  });
});

describe("navigation model vs nav-guard PageClass", () => {
  it("internal shell exactly covers the admin PageClass", () => {
    for (const spec of ROUTES) {
      const pageClass = classifyPage(spec.path);
      expect(pageClassOf(spec)).toBe(pageClass);
      expect(spec.shell === "internal").toBe(pageClass === "admin");
    }
  });

  it("internal routes are visible to operator roles only (route-specific)", () => {
    const internal = ROUTES.filter((spec) => spec.shell === "internal");
    expect(internal.map((spec) => spec.path).sort()).toEqual(
      ["/pages/admin/admin", "/pages/ops/ops"].sort(),
    );
    for (const spec of internal) {
      expect(isVisibleToRole(spec, null)).toBe(false);
      expect(isVisibleToRole(spec, "USER")).toBe(false);
      // 未设 allowedRoles 的内部路由回退到操作者角色全集。
      if (!spec.allowedRoles) {
        for (const role of ["ADMIN", "SAFETY_REVIEWER", "PRIVACY_OPERATOR", "OPS_VIEWER"]) {
          expect(isVisibleToRole(spec, role)).toBe(true);
        }
      }
    }
    for (const spec of ROUTES.filter((s) => s.shell !== "internal")) {
      expect(isVisibleToRole(spec, "USER")).toBe(true);
      expect(isVisibleToRole(spec, null)).toBe(true);
    }
  });

  it("isOperatorRole mirrors nav-guard OPERATOR_ROLES", () => {
    expect(isOperatorRole("ADMIN")).toBe(true);
    expect(isOperatorRole("OPS_VIEWER")).toBe(true);
    expect(isOperatorRole("USER")).toBe(false);
    expect(isOperatorRole(null)).toBe(false);
    expect(isOperatorRole(undefined)).toBe(false);
  });

  it("public PageClass routes keep consumer access (no role gate)", () => {
    const publicPaths = ROUTES.filter(
      (spec) => classifyPage(spec.path) === "public",
    ).map((spec) => spec.path);
    expect(publicPaths.sort()).toEqual(
      [
        "/pages/ai-notice/ai-notice",
        "/pages/health/health",
        "/pages/help/help",
        "/pages/index/index",
      ].sort(),
    );
  });
});

describe("consumer shell IA", () => {
  it("provides exactly four tabs: home, chats, memory, me", () => {
    expect(CONSUMER_TABS.map((tab) => tab.key)).toEqual([
      "home",
      "chats",
      "memory",
      "me",
    ]);
    for (const tab of CONSUMER_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.href.startsWith("/pages/")).toBe(true);
      const target = specOf(tab.href);
      expect(target.shell).toBe("consumer-tab");
      expect(target.tab).toBe(tab.key);
    }
  });

  it("bottom nav renders on tab roots and consumer sub pages only", () => {
    for (const spec of ROUTES) {
      const expectBar =
        spec.shell === "consumer-tab" || spec.shell === "consumer-sub";
      expect(hasBottomNav(spec), spec.path).toBe(expectBar);
    }
    const noBar = ROUTES.filter((spec) => !hasBottomNav(spec)).map(
      (spec) => spec.path,
    );
    expect(noBar.sort()).toEqual(
      [
        "/pages/age/age",
        "/pages/chat/chat",
        "/pages/consent/consent",
        "/pages/login/login",
        "/pages/ops/ops",
        "/pages/admin/admin",
      ].sort(),
    );
  });

  it("chat is the immersive detail of the chats tab", () => {
    const chat = specOf("/pages/chat/chat");
    expect(chat.shell).toBe("immersive");
    expect(chat.tab).toBe("chats");
  });

  it("admission pages carry no tab and never appear as consumer tabs", () => {
    for (const path of [
      "/pages/login/login",
      "/pages/age/age",
      "/pages/consent/consent",
    ]) {
      expect(specOf(path).shell).toBe("admission");
      expect(specOf(path).tab).toBeNull();
    }
    expect(CONSUMER_TABS.map((tab) => tab.href)).not.toContain(
      "/pages/login/login",
    );
  });

  it("me section groups are complete and ordered", () => {
    expect(ME_GROUP_ORDER).toEqual([
      "account",
      "companion",
      "reminders",
      "wellbeing",
      "privacy",
      "data",
      "help",
    ]);
    const mePages = ROUTES.filter((spec) => spec.section === "me");
    expect(mePages.map((spec) => spec.path).sort()).toEqual(
      [
        "/pages/account/account",
        "/pages/ai-notice/ai-notice",
        "/pages/age/age",
        "/pages/companion/companion",
        "/pages/consent/consent",
        "/pages/data/data",
        "/pages/export/export",
        "/pages/health/health",
        "/pages/help/help",
        "/pages/incognito/incognito",
        "/pages/reminder/reminder",
        "/pages/report/report",
      ].sort(),
    );
    for (const spec of mePages) {
      expect(ME_GROUP_ORDER, spec.path).toContain(spec.meGroup);
    }
  });
});

describe("deep-link query contract", () => {
  it("relationship-scoped pages declare relationshipId", () => {
    for (const path of [
      "/pages/chat/chat",
      "/pages/conversations/conversations",
      "/pages/memory/memory",
      "/pages/memory-detail/memory-detail",
      "/pages/companion/companion",
      "/pages/reminder/reminder",
    ]) {
      expect(specOf(path).allowedQuery, path).toContain("relationshipId");
    }
  });

  it("chat carries conversationId; report carries messageId", () => {
    expect(specOf("/pages/chat/chat").allowedQuery).toContain(
      "conversationId",
    );
    expect(specOf("/pages/report/report").allowedQuery).toContain(
      "messageId",
    );
  });

  it("memory pages carry memoryId; login carries return", () => {
    expect(specOf("/pages/memory/memory").allowedQuery).toContain("memoryId");
    expect(specOf("/pages/memory-detail/memory-detail").allowedQuery).toContain(
      "memoryId",
    );
    expect(specOf("/pages/login/login").allowedQuery).toContain("return");
  });

  it("account keeps the password-change deep link", () => {
    expect(specOf("/pages/account/account").allowedQuery).toContain(
      "passwordChange",
    );
  });
});

describe("route-specific allowedRoles (internal entries)", () => {
  it("ops is ADMIN-only; admin is open to every operator role", () => {
    const ops = routeSpecOf("/pages/ops/ops")!;
    const admin = routeSpecOf("/pages/admin/admin")!;
    const matrix: Record<string, { ops: boolean; admin: boolean }> = {
      ADMIN: { ops: true, admin: true },
      SAFETY_REVIEWER: { ops: false, admin: true },
      PRIVACY_OPERATOR: { ops: false, admin: true },
      OPS_VIEWER: { ops: false, admin: true },
      USER: { ops: false, admin: false },
    };
    for (const [role, expected] of Object.entries(matrix)) {
      expect(isVisibleToRole(ops, role), `${role} ops`).toBe(expected.ops);
      expect(isVisibleToRole(admin, role), `${role} admin`).toBe(expected.admin);
    }
  });

  it("consumer routes stay role-agnostic", () => {
    const home = routeSpecOf("/pages/index/index")!;
    expect(isVisibleToRole(home, "USER")).toBe(true);
    expect(isVisibleToRole(home, null)).toBe(true);
  });
});

describe("internal entry visibility matches the target page guards", () => {
  // 交叉对账：入口可见性（navigation.allowedRoles）必须与目标页面自己的
  // 守卫（ops 仅 ADMIN；admin 全操作者可进，分区权限在页面内部）一致。
  const ops = routeSpecOf("/pages/ops/ops")!;
  const admin = routeSpecOf("/pages/admin/admin")!;
  const roles = [
    "ADMIN",
    "SAFETY_REVIEWER",
    "PRIVACY_OPERATOR",
    "OPS_VIEWER",
    "USER",
    null,
  ];
  for (const role of roles) {
    it(`entry visibility equals page guards for ${role ?? "no role"}`, () => {
      expect(isVisibleToRole(ops, role)).toBe(canEnterOpsPage(role));
      expect(isVisibleToRole(admin, role)).toBe(canEnterAdminPage(role));
    });
  }
});
