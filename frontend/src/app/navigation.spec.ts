import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyPage } from "@/domain/nav-guard";

import {
  CONSUMER_TABS,
  hasBottomNav,
  isOperatorRole,
  isVisibleToRole,
  pageClassOf,
  routeSpecOf,
  ROUTES,
  type RouteSpec,
} from "./navigation";

const rawPagesJson = readFileSync(resolve(process.cwd(), "src/pages.json"), "utf8");
const pagesJson = JSON.parse(rawPagesJson.replace(/\/\/.*$/gm, "")) as {
  pages: Array<{ path: string; style: { navigationBarTitleText: string } }>;
};

const PAGE_PATHS = pagesJson.pages.map((page) => `/${page.path}`);

function specOf(path: string): RouteSpec {
  const spec = routeSpecOf(path);
  if (!spec) throw new Error(`missing RouteSpec for ${path}`);
  return spec;
}

describe("navigation model coverage", () => {
  it("contains exactly the ten current product routes", () => {
    expect(PAGE_PATHS).toHaveLength(10);
    expect(new Set(PAGE_PATHS).size).toBe(PAGE_PATHS.length);
    expect(ROUTES.map((spec) => spec.path).sort()).toEqual([...PAGE_PATHS].sort());
  });

  it("keeps page titles aligned with pages.json", () => {
    for (const page of pagesJson.pages) {
      expect(specOf(`/${page.path}`).title).toBe(page.style.navigationBarTitleText);
    }
  });

  it("resolves query-bearing routes and rejects removed routes", () => {
    expect(routeSpecOf("/pages/chat/chat?conversationId=42")?.path).toBe(
      "/pages/chat/chat",
    );
    expect(routeSpecOf("/pages/memory/memory")).toBeNull();
  });
});

describe("consumer information architecture", () => {
  it("provides exactly home, chat and me in that order", () => {
    expect(CONSUMER_TABS).toEqual([
      { key: "home", label: "首页", href: "/pages/index/index" },
      { key: "chats", label: "聊天", href: "/pages/chat/chat" },
      { key: "me", label: "我的", href: "/pages/account/account" },
    ]);
  });

  it("renders the bottom nav only on the three tab roots", () => {
    expect(ROUTES.filter(hasBottomNav).map((spec) => spec.path)).toEqual([
      "/pages/index/index",
      "/pages/chat/chat",
      "/pages/account/account",
    ]);
    expect(hasBottomNav(specOf("/pages/conversations/conversations"))).toBe(false);
  });

  it("keeps all conversations as a chat subpage and login as admission", () => {
    expect(specOf("/pages/conversations/conversations")).toMatchObject({
      shell: "consumer-sub",
      tab: "chats",
      section: "chats",
    });
    expect(specOf("/pages/login/login")).toMatchObject({
      shell: "admission",
      tab: null,
    });
  });

  it("keeps only the account root in the me section", () => {
    expect(ROUTES.filter((spec) => spec.section === "me").map((spec) => spec.path)).toEqual([
      "/pages/account/account",
    ]);
  });
});

describe("admin access and route contracts", () => {
  it("maps all five admin routes to ADMIN-only internal pages", () => {
    const internal = ROUTES.filter((spec) => spec.shell === "internal");
    expect(internal).toHaveLength(5);
    for (const spec of internal) {
      expect(classifyPage(spec.path)).toBe("admin");
      expect(pageClassOf(spec)).toBe("admin");
      expect(isVisibleToRole(spec, "ADMIN")).toBe(true);
      expect(isVisibleToRole(spec, "USER")).toBe(false);
      expect(isVisibleToRole(spec, null)).toBe(false);
    }
  });

  it("recognizes operator roles without widening ADMIN-only routes", () => {
    expect(isOperatorRole("ADMIN")).toBe(true);
    expect(isOperatorRole("OPS_VIEWER")).toBe(true);
    expect(isOperatorRole("USER")).toBe(false);
  });

  it("declares only the query parameters used by current pages", () => {
    expect(specOf("/pages/chat/chat").allowedQuery).toEqual([
      "relationshipId",
      "conversationId",
    ]);
    expect(specOf("/pages/conversations/conversations").allowedQuery).toEqual([
      "relationshipId",
    ]);
    expect(specOf("/pages/account/account").allowedQuery).toEqual(["passwordChange"]);
    expect(specOf("/pages/login/login").allowedQuery).toEqual(["return"]);
  });
});
