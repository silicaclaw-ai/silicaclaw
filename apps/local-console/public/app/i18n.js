export function createI18n(translations) {
  const LOCALE_STORAGE_KEY = "silicaclaw.i18n.locale";
  const DEFAULT_LOCALE = "en";
  const SUPPORTED_LOCALES = ["en", "zh-CN"];

  function isSupportedLocale(value) {
    return SUPPORTED_LOCALES.includes(value);
  }

  function resolveNavigatorLocale(language) {
    return String(language || "").toLowerCase().startsWith("zh") ? "zh-CN" : DEFAULT_LOCALE;
  }

  function resolveInitialLocale() {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(saved)) return saved;
    return resolveNavigatorLocale(globalThis.navigator?.language || "");
  }

  let currentLocale = resolveInitialLocale();

  function t(key, params = {}) {
    const parts = key.split(".");
    const resolve = (bundle) => parts.reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), bundle);
    let value = resolve(translations[currentLocale]);
    if (typeof value !== "string") value = resolve(translations[DEFAULT_LOCALE]);
    if (typeof value !== "string") return key;
    return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
  }

  function setLocale(locale) {
    currentLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    document.documentElement.lang = currentLocale;
    return currentLocale;
  }

  return {
    DEFAULT_LOCALE,
    getCurrentLocale: () => currentLocale,
    setLocale,
    t,
  };
}
