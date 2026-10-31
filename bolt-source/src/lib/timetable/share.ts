import { supabase } from '../supabaseClient';
import type { TimetableBlock, Artifact } from '../../db/schema';

function slug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function stripRuntimeFields(block: TimetableBlock): Record<string, unknown> {
  const { ...rest } = block;
  return rest;
}

function artifactSnapshot(a: Artifact): Record<string, unknown> {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    mediaType: a.mediaType,
    data: a.data,
    meta: a.meta ?? {},
    version: a.version,
  };
}

export interface SharedBlockPayload {
  id: string;
  block_data: TimetableBlock;
  artifacts_data: Array<{
    id: string;
    type: Artifact['type'];
    title: string;
    mediaType: string;
    data: string;
    meta: Record<string, unknown>;
    version?: number;
  }>;
  created_at: string;
  updated_at: string;
  revoked: boolean;
}

export async function publishShare(params: {
  block: TimetableBlock;
  artifacts: Artifact[];
  ownerUsername: string;
  existingShareId?: string;
}): Promise<{ shareId: string }> {
  const { block, artifacts, ownerUsername, existingShareId } = params;
  const shareId = existingShareId ?? slug();
  const payload = {
    id: shareId,
    owner_username: ownerUsername,
    block_data: stripRuntimeFields(block),
    artifacts_data: artifacts.map(artifactSnapshot),
    updated_at: new Date().toISOString(),
    revoked: false,
  };
  const { error } = await supabase
    .from('shared_blocks')
    .upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`Failed to publish share: ${error.message}`);
  return { shareId };
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_blocks')
    .update({ revoked: true, updated_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) throw new Error(`Failed to revoke: ${error.message}`);
}

export async function fetchShare(shareId: string): Promise<SharedBlockPayload | null> {
  const { data, error } = await supabase
    .from('shared_blocks')
    .select('id, block_data, artifacts_data, created_at, updated_at, revoked')
    .eq('id', shareId)
    .eq('revoked', false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SharedBlockPayload | null) ?? null;
}

export function buildShareUrl(shareId: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/share/${shareId}`;
}

export function buildEmbedIframe(shareId: string, opts?: { width?: string; height?: string }): string {
  const url = buildShareUrl(shareId);
  const w = opts?.width ?? '100%';
  const h = opts?.height ?? '600';
  return `<iframe src="${url}" width="${w}" height="${h}" frameborder="0" style="border:1px solid #ccc;border-radius:8px;" allowfullscreen></iframe>`;
}
