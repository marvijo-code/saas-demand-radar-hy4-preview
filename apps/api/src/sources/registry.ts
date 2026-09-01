import type { SourceAdapter } from './types.ts';
import { redditAdapter } from './reddit.ts';
import { snapshotAdapter } from './snapshot.ts';
import { xAdapter } from './x.ts';

export const ADAPTERS: readonly SourceAdapter[] = [snapshotAdapter, xAdapter, redditAdapter];

export const ADAPTER_IDS = ADAPTERS.map((adapter) => adapter.id);

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

export function describeAdapters() {
  return ADAPTERS.map((adapter) => adapter.describe());
}

export { redditAdapter, snapshotAdapter, xAdapter };
export type { AdapterContext, AdapterDescriptor, AdapterResult, SourceAdapter } from './types.ts';
