// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentSession, emptyDocument } from '@mindmap/core';
import { GeometryBarrier } from '../src/canvas/geometry-barrier.js';
import { buildScene } from '../../export/src/scene.js';
vi.mock('@xyflow/react', () => import('./helpers/rf-stub.js').then(m => m.rfStubModule()));
const { ContextToolbar } = await import('../src/canvas/context-toolbar.js');
afterEach(cleanup);
it('A+ after B must increase the effective default size and preserve bold', () => {
  const doc = emptyDocument();
  doc.document.nodes.push({id:'a', text:'ABCD', position:{x:0,y:0}, size:{width:120,height:50}, runs:[{start:0,end:4,bold:true}]});
  const onCommand = vi.fn();
  render(<ContextToolbar document={doc} selection={{nodes:['a'],edges:[]}} primaryNodeId='a' onCommand={onCommand}/>);
  fireEvent.click(screen.getByRole('button',{name:'A+'}));
  expect(onCommand.mock.calls[0]![0].runs).toEqual([{start:0,end:4,bold:true,fontSize:18}]);
});
it('WenKai requested bold must reach the existing fauxBold scene path', () => {
  const doc = emptyDocument();
  doc.document.font = 'lxgw-wenkai';
  doc.document.nodes.push({id:'a',text:'ABCD',position:{x:0,y:0},size:{width:120,height:50},runs:[{start:0,end:4,bold:true}]});
  const result = buildScene(doc,{regular:()=>({advance:()=>10,ascentRatio:0.8}),bold:()=>null},()=> 'LXGW WenKai');
  expect(result.ok).toBe(true);
  if(result.ok) {
    const segments=result.scene.items.flatMap(it=>it.kind==='text'?it.segments:[]);
    expect(segments.some(seg=>seg.bold && seg.fauxBold)).toBe(true);
  }
});
const fonts = {regular: () => ({advance: () => 10, ascentRatio: 0.8}), bold: () => ({advance: () => 10, ascentRatio: 0.8})};
it('a recovered newer ready intent must not be overwritten by the older failed intent on flush', async () => {
  const session = new DocumentSession(emptyDocument());
  session.commit({kind:'CreateNode', id:'a', text:'body', position:{x:0,y:0}, size:{width:120,height:50}});
  let fail = true;
  const barrier = new GeometryBarrier({session, getMetricsState: () => 'ready', whenMetricsReady: async () => fonts,
    getFallbackFonts: () => {if(fail) throw new Error('transient metrics failure'); return fonts;}, onError: () => {}});
  await barrier.enqueue({kind:'set-kicker', id:'a', kicker:'older'});
  expect(barrier.hasPendingIntents()).toBe(true);
  fail = false;
  await barrier.enqueue({kind:'set-kicker', id:'a', kicker:'latest'});
  await barrier.flush();
  expect(session.current.document.document.nodes[0]!.kicker).toBe('latest');
});
it('whole-node B must style unformatted gaps while retaining existing fontSize', () => {
  const doc = emptyDocument();
  doc.document.nodes.push({id:'a', text:'ABCD', position:{x:0,y:0}, size:{width:120,height:50}, runs:[{start:1,end:2,fontSize:18}]});
  const onCommand = vi.fn();
  render(<ContextToolbar document={doc} selection={{nodes:['a'],edges:[]}} primaryNodeId='a' onCommand={onCommand}/>);
  fireEvent.click(screen.getByRole('button',{name:'B'}));
  const command = onCommand.mock.calls[0]![0];
  for(let i=0;i<4;i++) expect(command.runs.some((r: {start:number;end:number;bold?:boolean}) => r.start<=i && r.end>i && r.bold)).toBe(true);
  expect(command.runs.find((r: {start:number;end:number}) => r.start<=1 && r.end>1).fontSize).toBe(18);
});
