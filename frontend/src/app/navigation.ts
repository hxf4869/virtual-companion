// 生产导航模型（前端产品化重构）：Consumer Shell / Internal Shell 的唯一
// 展示真源。覆盖全部已发布路由的外壳形态、四入口归属、"我的"分组、
// 深链 query 参数与角色可见性。安全权威仍是 domain/nav-guard.ts（服务端
// Admission Gate + PageClass）；本模型绝不放宽它，只描述页面如何呈现。

import { classifyPage, OPERATOR_ROLES, type PageClass } from "@/domain/nav-guard";

export type ShellKind =
  | "consumer-tab" // 四入口根页：Consumer Shell + 底栏（tab 高亮）
  | "consumer-sub" // 消费者二级页：Page Header 返回 + 底栏常驻
  | "immersive" // 沉浸式详情（chat）：无底栏，自带头部返回与上下文操作
  | "admission" // 线性准入（登录/成年/同意）：无四入口底栏
  | "internal"; // Internal Shell：按角色守卫的内部页面

export type TabKey = "home" | "chats" | "memory" | "me";

export type IaSection =
  | "home"
  | "chats"
  | "memory"
  | "me"
  | "admission"
  | "internal";

export type MeGroup =
  | "account"
  | "companion"
  | "privacy"
  | "data"
  | "help";

export interface RouteSpec {
  /** hash 路由的页面路径（不含 query），与 pages.json 一一对应。 */
  readonly path: string;
  /** 用户可见页面标题；与 pages.json navigationBarTitleText 保持一致。 */
  readonly title: string;
  readonly shell: ShellKind;
  /** Consumer Shell 中高亮的四入口；无底栏的外壳为 null。 */
  readonly tab: TabKey | null;
  /** 目标信息架构归属。 */
  readonly section: IaSection;
  /** "我的"下的分组；非"我的"归属为 null。 */
  readonly meGroup: MeGroup | null;
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

// 四入口 Consumer Shell 底栏。顺序即渲染顺序；首页固定第一。
export const CONSUMER_TABS: readonly TabDef[] = [
  { key: "home", label: "首页", href: "/pages/index/index" },
  { key: "chats", label: "对话", href: "/pages/conversations/conversations" },
  { key: "memory", label: "记忆", href: "/pages/memory/memory" },
  { key: "me", label: "我的", href: "/pages/account/account" },
];

export const ROUTES: readonly RouteSpec[] = [
  {
    path: "/pages/index/index",
    title: "首页",
    shell: "consumer-tab",
    tab: "home",
    section: "home",
    meGroup: null,
    allowedQuery: [],
  },
  {
    path: "/pages/chat/chat",
    title: "对话",
    shell: "immersive",
    tab: "chats",
    section: "chats",
    meGroup: null,
    allowedQuery: ["relationshipId", "conversationId"],
  },
  {
    path: "/pages/conversations/conversations",
    title: "对话",
    shell: "consumer-tab",
    tab: "chats",
    section: "chats",
    meGroup: null,
    allowedQuery: ["relationshipId"],
  },
  {
    path: "/pages/memory/memory",
    title: "记忆",
    shell: "consumer-tab",
    tab: "memory",
    section: "memory",
    meGroup: null,
    allowedQuery: ["relationshipId", "memoryId"],
  },
  {
    path: "/pages/memory-detail/memory-detail",
    title: "记忆详情",
    shell: "consumer-sub",
    tab: "memory",
    section: "memory",
    meGroup: null,
    allowedQuery: ["memoryId", "relationshipId"],
  },
  {
    path: "/pages/account/account",
    title: "我的",
    shell: "consumer-tab",
    tab: "me",
    section: "me",
    meGroup: "account",
    allowedQuery: ["passwordChange"],
  },
  {
    path: "/pages/companion/companion",
    title: "陪伴设置",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "companion",
    allowedQuery: ["relationshipId"],
  },
  {
    path: "/pages/incognito/incognito",
    title: "无痕默认",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "privacy",
    allowedQuery: [],
  },
  {
    path: "/pages/consent/consent",
    title: "同意管理",
    shell: "admission",
    tab: null,
    section: "me",
    meGroup: "privacy",
    allowedQuery: [],
  },
  {
    path: "/pages/age/age",
    title: "成年状态",
    shell: "admission",
    tab: null,
    section: "me",
    meGroup: "privacy",
    allowedQuery: [],
  },
  {
    path: "/pages/data/data",
    title: "我的数据",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "data",
    allowedQuery: [],
  },
  {
    path: "/pages/export/export",
    title: "数据导出",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "data",
    allowedQuery: [],
  },
  {
    path: "/pages/help/help",
    title: "帮助与反馈",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "help",
    allowedQuery: [],
  },
  {
    path: "/pages/report/report",
    title: "举报和申诉",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "help",
    allowedQuery: ["messageId"],
  },
  {
    path: "/pages/ai-notice/ai-notice",
    title: "AI 说明",
    shell: "consumer-sub",
    tab: "me",
    section: "me",
    meGroup: "privacy",
    allowedQuery: [],
  },
  {
    path: "/pages/login/login",
    title: "登录",
    shell: "admission",
    tab: null,
    section: "admission",
    meGroup: null,
    allowedQuery: ["return"],
  },
  {
    path: "/pages/admin/admin",
    title: "运行总览",
    shell: "internal",
    tab: null,
    section: "internal",
    meGroup: null,
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-models/admin-models",
    title: "模型服务",
    shell: "internal",
    tab: null,
    section: "internal",
    meGroup: null,
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-routing/admin-routing",
    title: "路由策略",
    shell: "internal",
    tab: null,
    section: "internal",
    meGroup: null,
    allowedQuery: [],
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/pages/admin-system/admin-system",
    title: "系统状态",
    shell: "internal",
    tab: null,
    section: "internal",
    meGroup: null,
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

/** 页面是否渲染四入口底栏（tab 根页与二级页常驻；沉浸/准入/内部页不渲染）。 */
export function hasBottomNav(spec: RouteSpec): boolean {
  return spec.shell === "consumer-tab" || spec.shell === "consumer-sub";
}

/** 与 nav-guard.classifyPage 对账：internal 外壳恰好覆盖 admin PageClass。 */
export function pageClassOf(spec: RouteSpec): PageClass {
  return classifyPage(spec.path);
}

/** "我的"下的分组导航（渲染顺序即展示顺序）。 */
export const ME_GROUP_ORDER: readonly MeGroup[] = [
  "account",
  "companion",
  "privacy",
  "data",
  "help",
];
