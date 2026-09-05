// 新产品导航模型：Consumer Shell / Admin Console 的唯一展示真源。
// 只登记当前产品页面，不为上线前的旧 URL 保留兼容路由。

import { classifyPage, OPERATOR_ROLES, type PageClass } from "@/domain/nav-guard";

export type ShellKind =
  | "consumer-tab" // 三入口根页：Consumer Shell + 底栏（tab 高亮）
  | "consumer-sub" // 消费者二级页：Page Header 返回，不重复底栏
  | "immersive" // 沉浸式详情：无底栏，自带头部返回与上下文操作
  | "admission" // 线性准入（登录/验证）：无三入口底栏
  | "internal"; // Internal Shell：按角色守卫的内部页面

export type TabKey = "home" | "chats" | "me";

export type IaSection =
  | "home"
  | "chats"
  | "me"
  | "admission"
  | "internal";

export interface RouteSpec {
  /** hash 路由的页面路径（不含 query），与 pages.json 一一对应。 */
  readonly path: string;
  /** 用户可见页面标题；与 pages.json navigationBarTitleText 保持一致。 */
  readonly title: string;
  readonly shell: ShellKind;
  /** Consumer Shell 中高亮的三入口；无底栏的外壳为 null。 */
  readonly tab: TabKey | null;
  /** 目标信息架构归属。 */
  readonly section: IaSection;
  /** 页面实际消费的深链 query 参数（只读透传参数不在此列）。 */
  readonly allowedQuery: readonly string[];
  /**
   * 路由级角色白名单（route-specific）：只有列出角色可见/可进入。
   * 未设置表示不按角色限制。与页面真实守卫一一对应：ops 的 Runtime 预检
   * 面仅 ADMIN；admin 面对全部操作者开放（分区权限在页面内部，不放宽
   * 后端权限）。Go Runtime 控制台的四个页面均为 ADMIN-only。
   */
  readonly allowedRoles?: readonly string[];
}

export interface TabDef {
  readonly key: TabKey;
  readonly label: string;
  readonly href: string;
}

// 三入口 Consumer Shell 底栏。顺序即渲染顺序；不得增减或改序。
export const CONSUMER_TABS: readonly TabDef[] = [
  { key: "home", label: "首页", href: "/pages/index/index" },
  { key: "chats", label: "聊天", href: "/pages/chat/chat" },
  { key: "me", label: "我的", href: "/pages/account/account" },
];

export const ROUTES: readonly RouteSpec[] = [
  {
    path: "/pages/index/index",
    title: "首页",
    shell: "consumer-tab",
    tab: "home",
    section: "home",
    allowedQuery: [],
  },
  {
    path: "/pages/chat/chat",
    title: "聊天",
    shell: "consumer-tab",
    tab: "chats",
    section: "chats",
    allowedQuery: ["relationshipId", "conversationId"],
  },
  {
    path: "/pages/conversations/conversations",
    title: "全部会话",
    shell: "consumer-sub",
    tab: "chats",
    section: "chats",
    allowedQuery: ["relationshipId"],
  },
  {
    path: "/pages/account/account",
    title: "我的",
    shell: "consumer-tab",
    tab: "me",
    section: "me",
    allowedQuery: ["passwordChange"],
  },
  {
    path: "/pages/login/login",
    title: "登录",
    shell: "admission",
    tab: null,
    section: "admission",
    allowedQuery: ["return"],
  },
  {
    path: "/pages/admin/admin",
    title: "注册审核",
    shell: "internal",
    tab: null,
    section: "internal",
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-accounts/admin-accounts",
    title: "账号",
    shell: "internal",
    tab: null,
    section: "internal",
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-models/admin-models",
    title: "模型与路由",
    shell: "internal",
    tab: null,
    section: "internal",
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-routing/admin-routing",
    title: "路由策略",
    shell: "internal",
    tab: null,
    section: "internal",
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-system/admin-system",
    title: "运行状态",
    shell: "internal",
    tab: null,
    section: "internal",
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
];

const ROUTE_BY_PATH: ReadonlyMap<string, RouteSpec> = new Map(
  ROUTES.map((spec) => [spec.path, spec]),
);

function pathOf(href: string): string {
  const cut = href.indexOf("?");
  return cut >= 0 ? href.slice(0, cut) : href;
}

export function routeSpecOf(href: string): RouteSpec | null {
  return ROUTE_BY_PATH.get(pathOf(href)) ?? null;
}

export function isOperatorRole(role: string | null | undefined): boolean {
  return typeof role === "string" && OPERATOR_ROLES.has(role);
}

/**
 * Internal Shell 路由只对操作者角色可见；普通用户导航中不出现入口、
 * 内部文案或数据轮廓。与 nav-guard.shouldRenderPageData 的数据面守卫
 * 互补：这里管入口可见性，那边管数据渲染。
 */
export function isVisibleToRole(spec: RouteSpec, role: string | null): boolean {
  if (spec.shell !== "internal") return true;
  if (spec.allowedRoles) {
    return typeof role === "string" && spec.allowedRoles.includes(role);
  }
  return isOperatorRole(role);
}

/** 页面是否渲染三入口底栏；二级页用返回路径，不重复占用底部空间。 */
export function hasBottomNav(spec: RouteSpec): boolean {
  return spec.shell === "consumer-tab";
}

/** 与 nav-guard.classifyPage 对账：internal 外壳恰好覆盖 admin PageClass。 */
export function pageClassOf(spec: RouteSpec): PageClass {
  return classifyPage(spec.path);
}
