// MRT-004 Wave 2 验收工具：列 Mind Map 进程的 on-screen 窗口（CGWindowList；
// 不依赖 System Events AX——本机 AX 枚举当前不可用，见 Wave 2 evidence）。
// 输出 TSV：owner\ttitle\tx,y w×h\tlayer。退出码 0=可查询。
import CoreGraphics

let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
import Foundation

guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    fputs("CGWindowListCopyWindowInfo failed\n", stderr)
    exit(1)
}
for w in list {
    let owner = w["kCGWindowOwnerName"] as? String ?? ""
    guard owner.lowercased().replacingOccurrences(of: " ", with: "").contains("mindmap") else { continue }
    let name = w["kCGWindowName"] as? String ?? ""
    let b = w["kCGWindowBounds"] as? [String: Any] ?? [:]
    let layer = w["kCGWindowLayer"] as? Int ?? -1
    let frame = "\(b["X"] ?? 0),\(b["Y"] ?? 0) \(b["Width"] ?? 0)x\(b["Height"] ?? 0)"
    print("\(owner)\t\(name)\t\(frame)\t\(layer)")
}
