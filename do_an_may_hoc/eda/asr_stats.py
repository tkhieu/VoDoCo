"""ASR-side EDA: audio/transcript lengths and a word-level comparison of ASR hypotheses with gold transcripts."""
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from .vi_ner import PUNCT

WER_BUCKETS = ((0.0, 0.0, '0%'), (0.0, 0.1, '0–10%'), (0.1, 0.3, '10–30%'), (0.3, float('inf'), '>30%'))


def text_key(text):
    """Key used by the VietMed snapshot: SHA-1 of the lower-cased, space-normalized transcript."""
    return hashlib.sha1(' '.join(text.lower().split()).encode('utf-8')).hexdigest()


def read_jsonl(path):
    with Path(path).open(encoding='utf-8') as f:
        return [json.loads(line) for line in f]


def norm_words(text):
    """NFC, lower case, punctuation replaced by spaces — the VietMed transcript convention."""
    text = unicodedata.normalize('NFC', text).lower()
    return ''.join(' ' if c in PUNCT else c for c in text).split()


TONE_MARKS = {'\u0300', '\u0301', '\u0303', '\u0309', '\u0323'}  # huyền, sắc, ngã, hỏi, nặng


def strip_diacritics(word):
    """Remove every mark (tone marks and the vowel marks ^, ˘, ơ/ư horn) and map đ to d."""
    base = unicodedata.normalize('NFD', word.replace('đ', 'd').replace('Đ', 'D'))
    return ''.join(c for c in base if unicodedata.category(c) != 'Mn')


def strip_tones(word):
    return unicodedata.normalize('NFC', ''.join(c for c in unicodedata.normalize('NFD', word) if c not in TONE_MARKS))


def orthographic(word):
    """Canonical form that ignores where the tone mark sits (khỏe = khoẻ, hóa = hoá)."""
    marks = ''.join(sorted(c for c in unicodedata.normalize('NFD', word) if unicodedata.category(c) == 'Mn'))
    return strip_diacritics(word) + '|' + marks + ('đ' if 'đ' in word else '')


def align(ref, hyp):
    """Levenshtein alignment -> list of (op, ref_index, ref_word, hyp_word) with op in {ok, sub, del, ins}."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]), d[i - 1, j] + 1, d[i, j - 1] + 1)
    ops, i, j = [], n, m
    while i or j:
        if i and j and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(('ok' if ref[i - 1] == hyp[j - 1] else 'sub', i - 1, ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i and d[i, j] == d[i - 1, j] + 1:
            ops.append(('del', i - 1, ref[i - 1], None))
            i -= 1
        else:
            ops.append(('ins', None, None, hyp[j - 1]))
            j -= 1
    return ops[::-1]


def edge_errors(ops):
    """Insertions/deletions before the first and after the last matched word: {start_ins, start_del, end_ins, end_del}.

    Utterances without any matched word are left out (returned as None) because they have no boundary to measure.
    """
    ok = [i for i, (op, *_) in enumerate(ops) if op == 'ok']
    if not ok:
        return None
    head, tail = ops[:ok[0]], ops[ok[-1] + 1:]
    return Counter({'start_ins': sum(o[0] == 'ins' for o in head), 'start_del': sum(o[0] == 'del' for o in head),
                    'end_ins': sum(o[0] == 'ins' for o in tail), 'end_del': sum(o[0] == 'del' for o in tail)})


def edit_distance(ref, hyp):
    return sum(op != 'ok' for op, *_ in align(ref, hyp))


def bucket(wer):
    return next(name for lo, hi, name in WER_BUCKETS if (wer == 0 if hi == 0 else lo < wer <= hi))


def compare(pairs, gold_entities, top=12):
    """pairs: [(utterance_id, gold_text, hypothesis)]; gold_entities: {gold_text: [(type, start, end)]} (end inclusive).

    An entity survives when every reference word of its span is aligned to an identical hypothesis word
    ("ignoring diacritics": identical after removing all marks).
    """
    ops_total, edges = Counter(), Counter()
    diac_sub = tone_only = tone_variant = no_match_utts = 0
    raw_err = nodiac_err = ortho_err = n_ref = 0
    sub_pairs, diac_pairs = Counter(), Counter()
    per_utt = []
    punct = digits = unk = 0
    survival = defaultdict(Counter)
    for uid, gold, hyp in pairs:
        ref, h = norm_words(gold), norm_words(hyp)
        ops = align(ref, h)
        c = Counter(op for op, *_ in ops)
        ops_total.update(c)
        e = edge_errors(ops)
        if e is None:
            no_match_utts += 1
        else:
            edges.update(e)
        status = {}
        for op, i, r, x in ops:
            if op == 'ok':
                status[i] = 'exact'
            elif op == 'sub':
                if strip_diacritics(r) == strip_diacritics(x):
                    status[i] = 'marks'
                    diac_sub += 1
                    tone_only += strip_tones(r) == strip_tones(x)
                    tone_variant += orthographic(r) == orthographic(x)
                    diac_pairs[(r, x)] += 1
                else:
                    sub_pairs[(r, x)] += 1
        errors = c['sub'] + c['del'] + c['ins']
        n_ref += len(ref)
        raw_err += edit_distance(gold.split(), hyp.split())  # punctuation (and casing, if any) count as errors
        nodiac_err += edit_distance([strip_diacritics(w) for w in ref], [strip_diacritics(w) for w in h])
        ortho_err += edit_distance([orthographic(w) for w in ref], [orthographic(w) for w in h])
        wer = errors / max(len(ref), 1)
        per_utt.append(wer)
        punct += any(ch in PUNCT for ch in hyp)
        digits += any(ch.isdigit() for ch in hyp)
        unk += h.count('unk')
        for t, a, b in gold_entities.get(' '.join(ref), []):
            span = [status.get(k) for k in range(a, b + 1)]
            exact = all(x == 'exact' for x in span)
            loose = all(x in ('exact', 'marks') for x in span)
            for key in (t, 'ALL', f'wer {bucket(wer)}'):
                survival[key]['n'] += 1
                survival[key]['exact'] += exact
                survival[key]['ignoring_diacritics'] += loose
    errors = ops_total['sub'] + ops_total['del'] + ops_total['ins']
    edge = sum(edges.values())
    w = np.asarray(per_utt)
    n = len(pairs)
    return {
        'utterances': n, 'reference_words': n_ref,
        'wer': {'corpus': errors / n_ref, 'raw_punct': raw_err / n_ref, 'ignoring_diacritics': nodiac_err / n_ref,
                'tone_placement_normalized': ortho_err / n_ref,
                'utterance_mean': float(w.mean()), 'utterance_median': float(np.median(w)),
                'buckets': {name: int(sum(bucket(x) == name for x in w)) for *_, name in WER_BUCKETS}},
        'errors': {'substitutions': ops_total['sub'], 'deletions': ops_total['del'], 'insertions': ops_total['ins'],
                   'diacritic_only_substitutions': diac_sub, 'diacritic_share_of_errors': diac_sub / errors,
                   'tone_only_substitutions': tone_only, 'tone_only_share_of_errors': tone_only / errors,
                   'tone_placement_variants': tone_variant, 'tone_placement_share_of_errors': tone_variant / errors,
                   'edge': dict(edges), 'edge_insertions_deletions': edge, 'edge_share_of_errors': edge / errors,
                   'utterances_without_matched_word': no_match_utts,
                   'top_diacritic_confusions': [[r, x, k] for (r, x), k in diac_pairs.most_common(top)],
                   'top_other_substitutions': [[r, x, k] for (r, x), k in sub_pairs.most_common(top)]},
        'style': {'hyp_with_punctuation': punct / n, 'hyp_with_digits': digits / n, 'hyp_unk_tokens': unk},
        'entity_survival': {k: {**v, 'exact_rate': v['exact'] / v['n'], 'ignoring_diacritics_rate': v['ignoring_diacritics'] / v['n']}
                            for k, v in sorted(survival.items())},
        'per_utterance_wer': [round(x, 4) for x in per_utt],
    }


def audio_summary(meta):
    """meta: VietMed utterance rows {split, duration, words, icd10_code, rec_condition}."""
    out = {}
    for split in ('train', 'dev', 'cv', 'test'):
        rows = [r for r in meta if r['split'] == split]
        dur = np.asarray([r['duration'] for r in rows])
        words = np.asarray([r['words'] for r in rows])
        icd = Counter(r['icd10_code'] for r in rows)
        rec = Counter(r['rec_condition'] for r in rows)
        out[split] = {
            'utterances': len(rows), 'hours': float(dur.sum() / 3600),
            'duration': {'mean': float(dur.mean()), 'median': float(np.median(dur)), 'p95': float(np.percentile(dur, 95)), 'max': float(dur.max())},
            'words': {'mean': float(words.mean()), 'median': float(np.median(words)), 'max': int(words.max())},
            'words_per_second': float(words.sum() / dur.sum()),
            'icd10_top': [[k, v / len(rows)] for k, v in icd.most_common(5)],
            'rec_condition_top': [[k, v / len(rows)] for k, v in rec.most_common(4)],
        }
    return out
