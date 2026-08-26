// StateIdentity：每个 canonical 状态的进程内唯一身份。
// 单调递增计数器，进程生命周期内永不复用——分叉历史/undo-back 的 dirty
// 判定完全依赖"身份不重号"这一性质（ADR 0003）。
// 不序列化、不进文件。

export type StateIdentity = bigint & { readonly __brand: "StateIdentity" };

let counter = 0n;

export function nextIdentity(): StateIdentity {
  counter += 1n;
  return counter as StateIdentity;
}

export function sameIdentity(a: StateIdentity, b: StateIdentity): boolean {
  return a === b;
}

/** 测试专用：重置计数器（产品代码禁止调用）。 */
export function __resetIdentityCounterForTests(): void {
  counter = 0n;
}
