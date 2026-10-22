// uni-h5 only injects literal uni.<method> references into production builds.
// Reading globalThis.uni works in dev but bypasses that injection and its
// built-in API CSS. These six APIs have existing application consumers.
export function getUniApi() {
  try {
    return {
      addInterceptor: uni.addInterceptor,
      navigateBack: uni.navigateBack,
      navigateTo: uni.navigateTo,
      redirectTo: uni.redirectTo,
      setClipboardData: uni.setClipboardData,
      showModal: uni.showModal,
    };
  } catch {
    // Component tests and non-uni hosts keep the existing browser fallbacks.
    return undefined;
  }
}
