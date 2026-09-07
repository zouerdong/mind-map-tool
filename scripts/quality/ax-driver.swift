// MRT-004W2R E2 driver：swift 直连 AX + CGEvent（零依赖）。
// 背景：本机 osascript/System Events 的 AX 窗口枚举当前不可用（窗口计数
// 恒 0，与 osascript 责任进程的 TCC 状态相关，Wave 2 验收已记录）；swift
// 进程直连 AXUIElement 可读全部应用窗口（实测 Chrome/ChatGPT/app 均可）。
// 本脚本承担 runner 的全部 UI 驱动与 AX 断言：
//   windows                    列 app 全部 AX 窗口（JSON：title/x/y/w/h）
//   texts <winIdx>             收集窗口内全部元素文本（JSON 数组；断言用）
//   find <winIdx> <substr>     找 desc/title/value 含 substr 的首个元素
//                              （JSON：found/desc/x/y/w/h；找不到 found=false）
//   activate                   激活 app
//   click <x> <y>              CGEvent 单击（全局屏幕坐标）
//   dblclick <x> <y>           CGEvent 双击
//   key <keyCode> [alt|cmd|ctrl|shift](逗号分隔)  CGEvent 键
//   type <utf8 text>           CGEvent unicode 字符串输入（文本键入）
// CGEvent 与 AX position 同为全局坐标（主屏左上原点）。

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

let APP_NAME = "Mind Map"

func json(_ obj: Any) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let s = String(data: data, encoding: .utf8) else { return "null" }
  return s
}

func appRef() -> AXUIElement? {
  guard let app = NSWorkspace.shared.runningApplications.first(where: {
    $0.localizedName == APP_NAME
  }) else { return nil }
  return AXUIElementCreateApplication(app.processIdentifier)
}

func attrString(_ el: AXUIElement, _ attr: CFString) -> String? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr, &v) == .success else { return nil }
  return v as? String
}

func frame(_ el: AXUIElement) -> [String: Int]? {
  var p: CFTypeRef?
  var s: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &p) == .success,
        AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &s) == .success else { return nil }
  guard CFGetTypeID(p!) == AXValueGetTypeID(), CFGetTypeID(s!) == AXValueGetTypeID() else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(unsafeBitCast(p!, to: AXValue.self), .cgPoint, &pt)
  AXValueGetValue(unsafeBitCast(s!, to: AXValue.self), .cgSize, &sz)
  return ["x": Int(pt.x), "y": Int(pt.y), "w": Int(sz.width), "h": Int(sz.height)]
}

func appWindows() -> [AXUIElement] {
  guard let app = appRef() else { return [] }
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &v) == .success,
        let ws = v as? [AXUIElement] else { return [] }
  return ws
}

func children(_ el: AXUIElement) -> [AXUIElement] {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
        let cs = v as? [AXUIElement] else { return [] }
  return cs
}

func postClick(_ x: Double, _ y: Double, double: Bool) {
  let pt = CGPoint(x: x, y: y)
  func ev(_ type: CGEventType, state: Int64) -> CGEvent? {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: .left) else { return nil }
    e.setIntegerValueField(.mouseEventClickState, value: state)
    return e
  }
  // 先 post mouseMoved：无移动事件的 down/up 在部分原生控件（NSSavePanel
  // sheet 按钮）上不触发 hitTest/onClick（W2R 实测）
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: .left)?
    .post(tap: .cghidEventTap)
  Thread.sleep(forTimeInterval: 0.05)
  let down = ev(.leftMouseDown, state: 1), up = ev(.leftMouseUp, state: 1)
  down?.post(tap: .cghidEventTap)
  up?.post(tap: .cghidEventTap)
  if double {
    // 双击必须在短间隔内以 clickState=2 完成
    Thread.sleep(forTimeInterval: 0.08)
    let d2 = ev(.leftMouseDown, state: 2), u2 = ev(.leftMouseUp, state: 2)
    d2?.post(tap: .cghidEventTap)
    u2?.post(tap: .cghidEventTap)
  }
}

func flags(_ parts: [String]) -> CGEventFlags {
  var f: CGEventFlags = []
  for p in parts {
    switch p {
    case "alt": f.insert(.maskAlternate)
    case "cmd": f.insert(.maskCommand)
    case "ctrl": f.insert(.maskControl)
    case "shift": f.insert(.maskShift)
    default: break
    }
  }
  return f
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
  fputs("usage: ax-driver.swift windows|texts <win>|find <win> <substr>|activate|click <x> <y>|dblclick <x> <y>|key <code> [mods]|type <text>\n", stderr)
  exit(2)
}

switch cmd {
case "windows":
  var out: [[String: Any]] = []
  for (i, w) in appWindows().enumerated() {
    out.append([
      "idx": i,
      "title": attrString(w, kAXTitleAttribute as CFString) ?? "",
      "frame": frame(w) ?? NSNull(),
    ])
  }
  print(json(out))

case "findexact":
  // 精确匹配（desc/title/value 与目标全等）——用于同前缀元素（如面板
  // "Save" 按钮与 "Save As:" 标签）
  let eidx = Int(args[1]) ?? 0
  let eneedle = args.count > 2 ? args[2] : ""
  let ews = appWindows()
  guard eidx < ews.count else { print(#"{"found":false}"#); exit(0) }
  var ehit: [String: Any] = ["found": false]
  func ewalk(_ el: AXUIElement, _ depth: Int) -> Bool {
    if depth > 12 { return false }
    for attr in [kAXDescriptionAttribute as CFString, kAXTitleAttribute as CFString, kAXValueAttribute as CFString] {
      if let sv = attrString(el, attr), sv == eneedle {
        ehit = ["found": true, "desc": sv, "frame": frame(el) ?? NSNull()]
        return true
      }
    }
    for c in children(el) where ewalk(c, depth + 1) { return true }
    return false
  }
  _ = ewalk(ews[eidx], 0)
  print(json(ehit))

case "countnodes":
  // 数窗口内 desc 前缀「节点：」的元素（节点卡片 aria-label=节点：<文本>；
  // 建点/dirty 的 AX 级验证）
  let cidx = Int(args[1]) ?? 0
  let cws = appWindows()
  guard cidx < cws.count else { print(-1); exit(0) }
  var ccount = 0
  func cwalk(_ el: AXUIElement, _ depth: Int) {
    if depth > 12 { return }
    if let d = attrString(el, kAXDescriptionAttribute as CFString), d.hasPrefix("节点：") {
      ccount += 1
    }
    for c in children(el) { cwalk(c, depth + 1) }
  }
  cwalk(cws[cidx], 0)
  print(ccount)

case "press":
  // AXPress（无障碍标准动作）：对原生控件（NSSavePanel 按钮等）是可靠的
  // "按下"通道，不依赖 CGEvent 投递（WKWebView DOM 按钮不支持 press——
  // ax-bridge 实测 -1728；DOM 按钮仍走 click 坐标）。
  let pidx = Int(args[1]) ?? 0
  let pneedle = args.count > 2 ? args[2] : ""
  let pws = appWindows()
  guard pidx < pws.count else { print("NO_WINDOW"); exit(1) }
  var pel: AXUIElement?
  func pwalk(_ el: AXUIElement, _ depth: Int) -> Bool {
    if depth > 12 { return false }
    for attr in [kAXDescriptionAttribute as CFString, kAXTitleAttribute as CFString] {
      if let sv = attrString(el, attr), sv == pneedle {
        pel = el
        return true
      }
    }
    for c in children(el) where pwalk(c, depth + 1) { return true }
    return false
  }
  _ = pwalk(pws[pidx], 0)
  guard let target = pel else { print("NOT_FOUND"); exit(1) }
  let perr = AXUIElementPerformAction(target, kAXPressAction as CFString)
  print(perr == .success ? "OK" : "ERR\\(perr.rawValue)")

case "texts":
  let idx = Int(args[1]) ?? 0
  let ws = appWindows()
  guard idx < ws.count else { print("[]"); exit(0) }
  var seen = Set<String>()
  var out: [String] = []
  func walk(_ el: AXUIElement, _ depth: Int) {
    if depth > 12 { return }
    for attr in [kAXDescriptionAttribute as CFString, kAXTitleAttribute as CFString, kAXValueAttribute as CFString] {
      if let s = attrString(el, attr), !s.isEmpty, !seen.contains(s) {
        seen.insert(s)
        out.append(String(s.prefix(200)))
        break
      }
    }
    for c in children(el) { walk(c, depth + 1) }
  }
  walk(ws[idx], 0)
  print(json(out))

case "find":
  let idx = Int(args[1]) ?? 0
  let needle = args.count > 2 ? args[2] : ""
  let ws = appWindows()
  guard idx < ws.count else { print(#"{"found":false}"#); exit(0) }
  var hit: [String: Any] = ["found": false]
  func walk(_ el: AXUIElement, _ depth: Int) -> Bool {
    if depth > 12 { return false }
    for attr in [kAXDescriptionAttribute as CFString, kAXTitleAttribute as CFString, kAXValueAttribute as CFString] {
      if let s = attrString(el, attr), s.contains(needle) {
        hit = [
          "found": true,
          "desc": s,
          "frame": frame(el) ?? NSNull(),
        ]
        return true
      }
    }
    for c in children(el) where walk(c, depth + 1) { return true }
    return false
  }
  _ = walk(ws[idx], 0)
  print(json(hit))

case "move":
  // 移动窗口（E2 多窗分摆：窗口互不遮挡，区域截图/断言独立）
  let idx = Int(args[1]) ?? 0
  let x = Double(args[2]) ?? 0, y = Double(args[3]) ?? 0
  let ws = appWindows()
  guard idx < ws.count else { print("NO_WINDOW"); exit(1) }
  var pt = CGPoint(x: x, y: y)
  guard let v = AXValueCreate(.cgPoint, &pt) else { print("ERR_CREATE"); exit(1) }
  let err = AXUIElementSetAttributeValue(ws[idx], kAXPositionAttribute as CFString, v)
  print(err == .success ? "OK" : "ERR\(err.rawValue)")

case "placewin":
  // 按「当前坐标附近」选窗并设置位置/尺寸（比 z 序可靠：新窗 spawn 于
  // 唯一的 (215,95)，其余窗口已在槽位——按位置命中即目标窗）
  let cx = Double(args[1]) ?? 0, cy = Double(args[2]) ?? 0
  let nx = Double(args[3]) ?? 0, ny = Double(args[4]) ?? 0
  let nw = Double(args[5]) ?? 840, nh = Double(args[6]) ?? 520
  let ws = appWindows()
  var target: AXUIElement?
  for w in ws {
    if let f = frame(w), abs(Double(f["x"] ?? 0) - cx) < 80, abs(Double(f["y"] ?? 0) - cy) < 80 {
      target = w
      break
    }
  }
  guard let w = target else { print("NO_WINDOW_AT"); exit(1) }
  var pt = CGPoint(x: nx, y: ny)
  var sz = CGSize(width: nw, height: nh)
  guard let pv = AXValueCreate(.cgPoint, &pt), let sv = AXValueCreate(.cgSize, &sz) else {
    print("ERR_CREATE"); exit(1)
  }
  let e1 = AXUIElementSetAttributeValue(w, kAXPositionAttribute as CFString, pv)
  let e2 = AXUIElementSetAttributeValue(w, kAXSizeAttribute as CFString, sv)
  print(e1 == .success && e2 == .success ? "OK" : "ERR\(e1.rawValue)/\(e2.rawValue)")

case "closewin":
  // 关闭窗口（原生通道）：window 的标准 close 按钮（kAXCloseButton）执行
  // AXPress——比 CGEvent 坐标点击稳定（后者在部分时段不被 AppKit 接受）。
  let clx = Double(args[1]) ?? 0, cly = Double(args[2]) ?? 0
  let clws = appWindows()
  var target: AXUIElement?
  for w in clws {
    if let f = frame(w), abs(Double(f["x"] ?? 0) - clx) < 80, abs(Double(f["y"] ?? 0) - cly) < 80 {
      target = w
      break
    }
  }
  guard let w = target else { print("NO_WINDOW_AT"); exit(1) }
  var btn: CFTypeRef?
  guard AXUIElementCopyAttributeValue(w, kAXCloseButtonAttribute as CFString, &btn) == .success,
        let closeBtn = btn else { print("NO_CLOSE_BUTTON"); exit(1) }
  let cerr = AXUIElementPerformAction(unsafeBitCast(closeBtn, to: AXUIElement.self), kAXPressAction as CFString)
  print(cerr == .success ? "OK" : "ERR\\(cerr.rawValue)")

case "activate":
  if let app = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == APP_NAME }) {
    app.activate(options: [])
    print("OK")
  } else {
    print("NO_APP"); exit(1)
  }

case "parkmouse":
  // 鼠标停靠到指定点（截图确定性：避免 hover 状态进入区域截图断言）
  let mx = Double(args[1]) ?? 0, my = Double(args[2]) ?? 0
  if let e = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: mx, y: my), mouseButton: .left) {
    e.post(tap: .cghidEventTap)
    print("OK")
  } else {
    print("ERR"); exit(1)
  }

case "dragwin":
  // 拖拽移动窗口（真实用户通道：抓标题栏 → 移动 → 释放；不依赖 AX 树
  // 的窗口顺序——新窗 spawn 后为 frontmost，z 序比 AX children 可靠）
  let fx = Double(args[1]) ?? 0, fy = Double(args[2]) ?? 0
  let tx = Double(args[3]) ?? 0, ty = Double(args[4]) ?? 0
  func moveEv(_ x: Double, _ y: Double) -> CGEvent? {
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
  }
  func dragEv(_ type: CGEventType, _ x: Double, _ y: Double) -> CGEvent? {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) else { return nil }
    e.setIntegerValueField(.mouseEventClickState, value: 1)
    return e
  }
  dragEv(.leftMouseDown, fx, fy)?.post(tap: .cghidEventTap)
  // 分步移动（窗口跟随动画窗口期）
  for i in 1...8 {
    let p = Double(i) / 8.0
    moveEv(fx + (tx - fx) * p, fy + (ty - fy) * p)?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.03)
  }
  Thread.sleep(forTimeInterval: 0.1)
  moveEv(tx, ty)?.post(tap: .cghidEventTap)
  Thread.sleep(forTimeInterval: 0.1)
  dragEv(.leftMouseUp, tx, ty)?.post(tap: .cghidEventTap)
  print("OK")

case "click", "dblclick":
  let x = Double(args[1]) ?? 0, y = Double(args[2]) ?? 0
  postClick(x, y, double: cmd == "dblclick")
  print("OK")

case "key":
  let code = CGKeyCode(UInt64(args[1]) ?? 0)
  let mods = args.count > 2 ? flags(args[2].split(separator: ",").map(String.init)) : []
  for down in [true, false] {
    if let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) {
      e.flags = mods
      e.post(tap: .cghidEventTap)
    }
  }
  print("OK")

case "type":
  let text = args.count > 1 ? args[1] : ""
  let utf16 = Array(text.utf16)
  let chunk = utf16.count > 20 ? 20 : utf16.count
  var start = 0
  while start < utf16.count {
    let len = min(chunk, utf16.count - start)
    if let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
      e.keyboardSetUnicodeString(stringLength: len, unicodeString: Array(utf16[start..<(start + len)]))
      e.post(tap: .cghidEventTap)
    }
    if let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
      e.keyboardSetUnicodeString(stringLength: len, unicodeString: Array(utf16[start..<(start + len)]))
      e.post(tap: .cghidEventTap)
    }
    start += len
  }
  print("OK")

default:
  fputs("unknown command \(cmd)\n", stderr)
  exit(2)
}
