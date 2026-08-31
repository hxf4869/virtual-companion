// Shell/组件统一导航入口：包装 uni 导航 API 的缺席（组件单测 happy-dom
// 环境）与异常。uni 导航守卫（nav-guard.ts 安装的拦截器）仍然生效——
// 这里只是安全壳，不是第二套路由守卫。

type UniNavigator = {
  navigateTo?: (options: { url: string }) => void;
  redirectTo?: (options: { url: string }) => void;
  navigateBack?: (options?: { delta?: number }) => void;
};

function uniApi(): UniNavigator | undefined {
  return (globalThis as Record<string, unknown>).uni as
    | UniNavigator
    | undefined;
}

/** 将 uni-app 页面路径转换为 H5 hash 路由，避免浏览器请求不存在的实体路径。 */
export function toH5Href(url: string): string {
  return url.startsWith("/pages/") ? `/#${url}` : url;
}

/** 前进导航（压栈）。 */
export function goTo(url: string): void {
  try {
    const uni = uniApi();
    if (uni?.navigateTo) {
      uni.navigateTo({ url });
    } else if (typeof location !== "undefined") {
      location.href = toH5Href(url);
    }
  } catch {
    // Presentation-only navigation; callers never rely on it for correctness.
  }
}

/** 顶层切换（替换当前页）：四入口底栏专用，避免返回栈无界增长。 */
export function switchTabTo(url: string): void {
  try {
    const uni = uniApi();
    if (uni?.redirectTo) {
      uni.redirectTo({ url });
    } else if (typeof location !== "undefined") {
      location.href = toH5Href(url);
    }
  } catch {
    // Presentation-only navigation.
  }
}

/** 返回上一页；无历史时回退到指定页面（如所属 tab 根）。 */
export function goBack(fallbackHref?: string): void {
  try {
    const uni = uniApi();
    if (uni?.navigateBack) {
      uni.navigateBack({ delta: 1 });
      return;
    }
    if (typeof history !== "undefined" && history.length > 1) {
      history.back();
      return;
    }
    if (fallbackHref) switchTabTo(fallbackHref);
  } catch {
    if (fallbackHref) switchTabTo(fallbackHref);
  }
}
