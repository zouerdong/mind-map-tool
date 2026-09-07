// 【存档，当前未使用】零依赖 W3C WebDriver 客户端（fetch → tauri-driver :4444）。
// tauri-driver v2.0.6 在 macOS 报 "not supported on this platform"（官方仅
// 支持 Linux/Windows，本机实测 2026-08-29）——macOS E2E 已改走
// ax-bridge.mjs（osascript/System Events）。本文件保留作为 Windows E2E
// （run-e2e-windows.ps1 路线）的协议参考，不在 macOS 套件中执行。
// 若启用（Windows）：safaridriver 限制不适用，但 WebView2/msedgedriver 的
// actions 兼容性仍需实测；实际使用的通道记入 evidence。

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
/** W3C key actions 修饰键码点（Unicode 私有区）。 */
const KEY = {
  Meta: "",
  Shift: "",
  Control: "",
};

export class WebDriverError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "WebDriverError";
    this.status = status;
    this.payload = payload;
  }
}

export class WebDriverClient {
  constructor(baseUrl = "http://127.0.0.1:4444") {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    /** 交互通道使用记录（evidence 透明化：actions / execute-fallback）。 */
    this.channelLog = [];
  }

  async #req(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) ?? {}) : {};
    if (!res.ok) {
      const msg = json.value?.message ?? text ?? res.statusText;
      throw new WebDriverError(
        `WebDriver ${method} ${path} -> ${res.status}: ${msg}`,
        res.status,
        json,
      );
    }
    return json.value ?? {};
  }

  /** 建立 session（capabilities.alwaysMatch 由调用方组装 tauri:options）。 */
  async newSession(capabilities) {
    const v = await this.#req("POST", "/session", { capabilities: { alwaysMatch: capabilities } });
    this.sessionId = v.sessionId;
    return v;
  }

  async deleteSession() {
    if (!this.sessionId) return;
    try {
      await this.#req("DELETE", `/session/${this.sessionId}`);
    } finally {
      this.sessionId = null;
    }
  }

  #elementRef(el) {
    return typeof el === "string" ? el : (el?.[ELEMENT_KEY] ?? el?.ELEMENT);
  }

  async findElement(using, value, root) {
    const base = root
      ? `/session/${this.sessionId}/element/${this.#elementRef(root)}/element`
      : `/session/${this.sessionId}/element`;
    try {
      const v = await this.#req("POST", base, { using, value });
      return this.#elementRef(v);
    } catch (e) {
      if (e.status === 404) return null; // no such element（轮询语义）
      throw e;
    }
  }

  findElements(using, value) {
    return this.#req("POST", `/session/${this.sessionId}/elements`, { using, value });
  }

  async elementText(el) {
    const v = await this.#req(
      "GET",
      `/session/${this.sessionId}/element/${this.#elementRef(el)}/text`,
    );
    return v;
  }

  async click(el) {
    await this.#req("POST", `/session/${this.sessionId}/element/${this.#elementRef(el)}/click`);
  }

  /** W3C key actions：[[mods...], "text"] 顺序派发（mods: "Meta"/"Shift"/…）。 */
  async sendKeys(el, text) {
    await this.#req("POST", `/session/${this.sessionId}/element/${this.#elementRef(el)}/value`, {
      text,
    });
  }

  async execute(script, args = []) {
    const v = await this.#req("POST", `/session/${this.sessionId}/execute/sync`, { script, args });
    return v;
  }

  async screenshot() {
    return this.#req("GET", `/session/${this.sessionId}/screenshot`); // base64
  }

  // ---- 高层交互原语（双通道：actions 优先，safaridriver 不支持时回落合成事件）----

  async #channel(name, fn, fallback) {
    try {
      const r = await fn();
      this.channelLog.push(`${name}:actions`);
      return { ok: true, via: "actions", value: r };
    } catch (e) {
      if (e.status === 400 || e.status === 405 || e.status === 501) {
        // unknown command / unsupported：safaridriver 常见
        const r = await fallback();
        this.channelLog.push(`${name}:execute-fallback`);
        return { ok: true, via: "execute-fallback", value: r };
      }
      throw e;
    }
  }

  /** 键盘事件派发到指定元素（React onKeyDown 走 root 委托，bubbles 生效）。 */
  async keyDown(selector, key, { meta = false, ctrl = false, shift = false } = {}) {
    return this.#channel(
      `key:${key}`,
      async () => {
        const mods = [
          ...(meta ? [KEY.Meta] : []),
          ...(ctrl ? [KEY.Control] : []),
          ...(shift ? [KEY.Shift] : []),
        ];
        const actions = [
          {
            type: "key",
            id: "k1",
            actions: [
              ...mods.map((m) => ({ type: "keyDown", value: m })),
              { type: "keyDown", value: key },
              { type: "keyUp", value: key },
              ...mods.map((m) => ({ type: "keyUp", value: m })),
            ],
          },
        ];
        await this.#req("POST", `/session/${this.sessionId}/actions`, { actions });
      },
      async () => {
        await this.execute(
          `const el = document.querySelector(arguments[0]);
           el.dispatchEvent(new KeyboardEvent('keydown', {
             key: arguments[1], bubbles: true, cancelable: true,
             metaKey: arguments[2], ctrlKey: arguments[3], shiftKey: arguments[4],
           }));`,
          [selector, key, meta, ctrl, shift],
        );
      },
    );
  }

  /** 双击（dblclick）：RF 节点进编辑 / pane 空白建节点。 */
  async doubleClick(selector) {
    return this.#channel(
      "dblclick",
      async () => {
        const actions = [
          {
            type: "pointer",
            id: "p1",
            parameters: { pointerType: "mouse" },
            actions: [
              { type: "pointerDown", button: 0 },
              { type: "pointerUp", button: 0 },
              { type: "pointerDown", button: 0 },
              { type: "pointerUp", button: 0 },
            ],
          },
        ];
        // actions API 无 selector 定位：先聚焦元素再派发（fallback 更直接）
        await this.execute(
          `document.querySelector(arguments[0])?.dispatchEvent(
          new MouseEvent('click', {bubbles:true}))`,
          [selector],
        );
        await this.#req("POST", `/session/${this.sessionId}/actions`, { actions });
      },
      async () => {
        await this.execute(
          `const el = document.querySelector(arguments[0]);
           const r = el.getBoundingClientRect();
           const init = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
           el.dispatchEvent(new PointerEvent('pointerdown', init));
           el.dispatchEvent(new MouseEvent('mousedown', init));
           el.dispatchEvent(new PointerEvent('pointerup', init));
           el.dispatchEvent(new MouseEvent('mouseup', init));
           el.dispatchEvent(new MouseEvent('click', init));
           el.dispatchEvent(new MouseEvent('dblclick', init));`,
          [selector],
        );
      },
    );
  }

  /** 指针拖动（RF 拖节点/框选）：pointerdown → move* → pointerup 合成序列。 */
  async drag(fromSelector, toX, toY, { steps = 8 } = {}) {
    const via = await this.execute(
      `const el = document.querySelector(arguments[0]);
       const r = el.getBoundingClientRect();
       const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
       const x1 = arguments[1], y1 = arguments[2];
       const steps = arguments[3];
       const mk = (type, x, y) => new PointerEvent(type, {
         bubbles: true, cancelable: true, view: window, pointerId: 1,
         pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y,
       });
       el.setPointerCapture?.(1);
       el.dispatchEvent(mk('pointerdown', x0, y0));
       el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, clientX: x0, clientY: y0}));
       for (let i = 1; i <= steps; i++) {
         const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
         el.dispatchEvent(mk('pointermove', x, y));
       }
       el.dispatchEvent(mk('pointerup', x1, y1));
       el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, clientX: x1, clientY: y1}));
       return { from: { x: x0, y: y0 } };`,
      [fromSelector, toX, toY, steps],
    );
    this.channelLog.push("drag:execute");
    return via;
  }

  /** 轮询等待 selector 出现/消失（WebDriver 404 语义 → null）。 */
  async waitFor(selector, { present = true, timeoutMs = 5000, intervalMs = 200 } = {}) {
    const start = Date.now();
    for (;;) {
      const el = await this.findElement("css selector", selector);
      if (present && el) return el;
      if (!present && !el) return null;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitFor(${selector}, present=${present}) 超时 ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
