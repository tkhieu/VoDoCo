import type { Session, Slot } from './session';
import { nerModels, type Model, type Schema, type Source } from './api';
import { mapEntities } from './entities';

function identity(model: Schema['ModelIdentity'] | null) {
  if (!model) return null;
  return { logical_id: model.logical_id, repo_id: model.repo_id, revision: model.revision, checkpoint_sha256: model.checkpoint_sha256, tokenizer: model.tokenizer, label_map_sha256: model.label_map_sha256, device: model.device, dtype: model.dtype };
}
function exportSlot(slot: Slot, text: string, source: Source, revision: number, hash: string | null, model: Model) {
  const result = slot.result;
  if (!result || result.source !== source || result.revision !== revision || result.text_sha256 !== hash || (result.model && result.model.logical_id !== model)) return { state: slot.state === 'succeeded' ? 'stale' : slot.state, source, revision, text_sha256: hash, model, entities: [] };
  return {
    state: slot.state, source, revision, text_sha256: hash, model: identity(result.model), duration_ms: result.duration_ms,
    error: result.error ? { code: result.error.code, stage: result.error.stage, model: result.error.model, retryable: result.error.retryable, message: result.error.message } : null,
    entities: mapEntities(text, result.entities).map(entity => ({ id: entity.id, text: entity.text, label: entity.label, start: entity.utf16Start === null ? null : entity.start, end: entity.utf16End === null ? null : entity.end, offset_unit: entity.offset_unit, ...(entity.score === undefined ? {} : { score: entity.score }) })),
  };
}
export function exportSession(session: Session, at = new Date().toISOString()) {
  const selectedSource = session.view === 'compare' ? 'raw' : session.source;
  const sources = (['raw', 'review'] as const).map(source => {
    const text = source === 'raw' ? session.asr?.raw_text ?? '' : session.review?.text ?? '';
    const revision = source === 'raw' ? 0 : session.review?.revision ?? 0;
    const hash = source === 'raw' ? session.asr?.text_sha256 ?? null : session.review?.hash ?? null;
    return [source, Object.fromEntries(nerModels.map(model => [model, exportSlot(session.slots[source][model], text, source, revision, hash, model)]))];
  });
  return {
    schema_version: '1', session_id: session.id, created_at: session.createdAt, exported_at: at,
    audio: session.audio ? { display_name: session.audio.name.replace(/^.*[\\/]/, ''), provenance: session.audio.provenance, duration_seconds: session.metadata?.duration_seconds ?? session.audio.duration, size_bytes: session.audio.blob.size, mime_type: session.audio.blob.type, decoded: session.metadata } : null,
    asr: session.asr ? { raw_text: session.asr.raw_text, text_sha256: session.asr.text_sha256, model: identity(session.asr.model), generation_settings: session.asr.generation_settings, postprocessing: session.asr.postprocessing, duration_ms: session.asr.duration_ms } : null,
    review: session.review ? { text: session.review.text, revision: session.review.revision, text_sha256: session.review.hash, confirmed_by_user: session.review.confirmed } : null,
    raw_confirmed_by_user: session.rawConfirmed, selected_view: session.view, selected_source: selectedSource, selected_model: session.model,
    results: Object.fromEntries(sources), correction: 'off',
  };
}
export function currentText(session: Session): string {
  return session.view !== 'compare' && session.source === 'review' ? session.review?.text ?? '' : session.asr?.raw_text ?? '';
}
export function download(session: Session, format: 'txt' | 'json') {
  const content = format === 'txt' ? currentText(session) : JSON.stringify(exportSession(session), null, 2);
  const source = session.view === 'compare' ? 'raw' : session.source;
  const revision = source === 'review' ? session.review?.revision ?? 0 : 0;
  const confirmed = source === 'review' ? session.review?.confirmed : session.rawConfirmed;
  const blob = new Blob([content], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `vodoco-${source}-r${revision}-${session.model}-${confirmed ? 'reviewed' : 'unreviewed'}.${format}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
