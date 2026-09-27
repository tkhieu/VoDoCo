"""Snapshot the ASR-side inputs of the EDA into ket_qua_goc/ so the notebook runs without the raw sources.

Sources (read-only):
- VietMed parquet metadata (duration, ICD-10 code, recording condition) of the four VietMed splits; the audio
  column is never read. Transcripts are not copied: only their word count and a SHA-1 of the normalized text
  (lower case, single spaces) are kept, which is enough to trace each VietMed-NER sentence to its VietMed split.
- PhoWhisper-medium hypotheses for the full VietMed test split (records written by the ASR error-triage
  experiment, generated with vinai/PhoWhisper-medium).
- Whisper-small (MultiMed-ST) hypotheses for the first 500 test utterances (giai_doan_dau-old/giai_doan_5).

Usage (from the repository root):
    python do_an_may_hoc/eda/export_asr_snapshot.py \
        --vietmed datasets/leduckhai/VietMed/data \
        --phowhisper experiments/003-asr-error-triage/outputs/full/records/test.jsonl \
        --whisper-small giai_doan_dau-old/giai_doan_5/results.jsonl
"""
import argparse
import hashlib
import json
from pathlib import Path

import pyarrow.parquet as pq

OUT = Path(__file__).resolve().parents[1] / 'ket_qua_goc'
META_COLUMNS = ['utterance_id', 'text', 'duration', 'icd10_code', 'rec_condition']


def text_key(text):
    # Same key as eda.asr_stats.text_key (this script runs standalone, outside the package).
    return hashlib.sha1(' '.join(text.lower().split()).encode('utf-8')).hexdigest()


def write_jsonl(path, rows):
    with path.open('w', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    print('wrote', path, len(rows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vietmed', type=Path, required=True)
    ap.add_argument('--phowhisper', type=Path, required=True)
    ap.add_argument('--whisper-small', type=Path, required=True)
    args = ap.parse_args()

    meta = []
    for split in ('train', 'dev', 'cv', 'test'):
        shards = sorted(args.vietmed.glob(f'{split}-*.parquet'))
        assert len(shards) == 1, f'expected one parquet shard for {split}, found {len(shards)}'
        table = pq.read_table(shards[0], columns=META_COLUMNS).to_pylist()
        meta += [{'split': split, 'utterance_id': r['utterance_id'], 'text_sha1': text_key(r['text']),
                  'words': len(r['text'].split()), 'duration': r['duration'], 'icd10_code': r['icd10_code'],
                  'rec_condition': r['rec_condition']} for r in table]
    write_jsonl(OUT / 'vietmed_utterances.jsonl', meta)

    test_ids = {m['utterance_id'] for m in meta if m['split'] == 'test'}
    for name, path, key in (('asr_test_phowhisper_medium.jsonl', args.phowhisper, 'hypothesis_text'),
                            ('asr_test_whisper_small.jsonl', args.whisper_small, 'transcript')):
        rows = [json.loads(line) for line in path.open(encoding='utf-8')]
        rows = [{'utterance_id': r['utterance_id'], 'hypothesis': r[key]} for r in rows]
        assert all(r['utterance_id'] in test_ids for r in rows), f'{path}: utterance not in VietMed test'
        write_jsonl(OUT / name, rows)


if __name__ == '__main__':
    main()
