/**
 * 浏览器在布局密集时可能抛出 ResizeObserver 相关「错误」：
 * - "ResizeObserver loop limit exceeded"
 * - "ResizeObserver loop completed with undelivered notifications."
 * 这些不是应用逻辑 bug；react-error-overlay 会当作未捕获错误弹出红屏。
 *
 * 红屏能否去掉取决于 listener 是否早于 overlay 注册；仅靠在 index.tsx 里注册可能晚于
 * webpack 注入的 overlay。主防线在 public/index.html 的内联 script（先于任意 bundle）。
 * 此处作为补充：console / onerror 等路径。
 */
function isResizeObserverNoise(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes('resizeobserver');
}

let installed = false;

export function installResizeObserverNoiseSuppression(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  const onError = (e: Event): void => {
    const ev = e as ErrorEvent;
    const msg = ev.message || (ev.error instanceof Error ? ev.error.message : '');
    if (isResizeObserverNoise(msg)) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  };
  window.addEventListener('error', onError, true);

  const onRejection = (e: PromiseRejectionEvent): void => {
    const r = e.reason;
    const msg = typeof r === 'string' ? r : r instanceof Error ? r.message : '';
    if (isResizeObserverNoise(msg)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  window.addEventListener('unhandledrejection', onRejection, true);

  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    const text = typeof first === 'string' ? first : first instanceof Error ? first.message : '';
    if (isResizeObserverNoise(text)) return;
    orig(...args);
  };

  const prevOnError = window.onerror;
  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ): boolean => {
    const msg = typeof message === 'string' ? message : error?.message || '';
    if (isResizeObserverNoise(msg)) return true;
    if (prevOnError) {
      return Boolean((prevOnError as typeof window.onerror).call(window, message, source, lineno, colno, error));
    }
    return false;
  };
}
