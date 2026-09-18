// Tarjan 强连通分量（迭代版，显式栈——10k 深链不爆调用栈）。
// 从 organize.ts 抽取（ADR 0020 起出现第二个真实消费者 node-depth.ts）；
// 实现逐字节沿用原函数，行为不变。返回 nodeId → sccId（0..count-1）。

/** Tarjan 强连通分量。返回 nodeId → sccId。 */
export function tarjanSCC(ids: string[], succ: Map<string, string[]>): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccOf = new Map<string, number>();
  let counter = 0;
  let sccCount = 0;
  for (const start of ids) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    const work: Array<{ v: string; i: number }> = [{ v: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const outs = succ.get(frame.v)!;
      if (frame.i < outs.length) {
        const w = outs[frame.i]!;
        frame.i += 1;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!;
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!));
        }
        if (low.get(frame.v) === index.get(frame.v)) {
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            sccOf.set(w, sccCount);
          } while (w !== frame.v);
          sccCount += 1;
        }
      }
    }
  }
  return sccOf;
}
