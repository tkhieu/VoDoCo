"""Compare the general-domain Vi-Ner corpus (Minggz/Vi-Ner) with VietMed-NER before using it for two-step fine-tuning."""
import string
import unicodedata
from collections import Counter
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from huggingface_hub import snapshot_download

from .ner_stats import all_spans

REPO = 'Minggz/Vi-Ner'
FILES = {'train': 'train', 'validation': 'val', 'test': 'test'}
# Vi-Ner type -> VietMed-NER type (None: no counterpart in VietMed-NER)
LABEL_MAP = {'PERSON': None, 'LOCATION': 'LOCATION', 'ORGANIZATION': 'ORGANIZATION', 'DATETIME': 'DATETIME'}
PUNCT = set(string.punctuation) | set('“”‘’…–—')


def load():
    root = Path(snapshot_download(REPO, repo_type='dataset'))
    data = {}
    for split, f in FILES.items():
        t = pq.read_table(root / f'{f}.parquet', columns=['tokens', 'ner_tags']).to_pydict()
        data[split] = (t['tokens'], t['ner_tags'])
    return data


def normalize(tokens):
    """VietMed-NER style: NFC, lower case, punctuation removed."""
    text = unicodedata.normalize('NFC', ' '.join(tokens)).lower()
    return ' '.join(''.join(' ' if c in PUNCT else c for c in text).split())


def corpus_stats(words_list, tags_list):
    lengths = [len(w) for w in words_list]
    toks = [x for w in words_list for x in w]
    ents = all_spans(words_list, tags_list)
    n_tok = len(toks)
    return {
        'sentences': len(words_list), 'tokens': n_tok,
        'len_mean': float(np.mean(lengths)), 'len_median': float(np.median(lengths)),
        'len_p95': float(np.percentile(lengths, 95)), 'len_max': int(max(lengths)),
        'uppercase_token_share': sum(x != x.lower() for x in toks) / n_tok,
        'punct_token_share': sum(any(c in PUNCT for c in x) for x in toks) / n_tok,
        'sentence_final_punct_share': sum(bool(w) and w[-1][-1:] in PUNCT for w in words_list) / len(words_list),
        'empty_tokens': sum(not x.strip() for x in toks),
        'entities_per_sentence': len(ents) / len(words_list),
        'entity_token_share': sum(t != 'O' for r in tags_list for t in r) / n_tok,
        'sentences_without_entity': sum(all(t == 'O' for t in r) for r in tags_list) / len(words_list),
        'entity_spans': dict(Counter(t for t, *_ in ents).most_common()),
    }


def duplicates(data, key):
    """Duplicates inside each split and exact overlaps between splits, under a sentence key function."""
    keys = {s: [key(w) for w in data[s][0]] for s in data}
    sets = {s: set(v) for s, v in keys.items()}
    out = {'within_split': {s: len(v) - len(sets[s]) for s, v in keys.items()}}
    for a, b in (('train', 'validation'), ('train', 'test'), ('validation', 'test')):
        out[f'{a}_{b}'] = len(sets[a] & sets[b])
    return out


def compare(vi, vm):
    """vi: Vi-Ner data, vm: VietMed-NER data (both {split: (words, tags)})."""
    stats = {'vi_ner': {s: corpus_stats(*vi[s]) for s in vi}, 'vietmed_ner': {s: corpus_stats(*vm[s]) for s in vm}}
    dup = {'raw': duplicates(vi, lambda w: ' '.join(w)), 'normalized': duplicates(vi, normalize)}

    vi_norm = {normalize(w) for s in vi for w in vi[s][0]}
    cross = {s: sum(' '.join(w) in vi_norm for w in vm[s][0]) for s in vm}

    # Surface coverage: can Vi-Ner entities of the mapped type cover VietMed-NER entities, especially unseen ones?
    vi_surface = {}  # Vi-Ner train only: the split that step 1 of the two-step fine-tune would use
    for t, _, _, surf in all_spans(*vi['train']):
        if LABEL_MAP[t]:
            vi_surface.setdefault(LABEL_MAP[t], set()).add(normalize(surf.split()))
    train_surface = {sp[3] for sp in all_spans(*vm['train'])}
    coverage = {}
    for t in sorted(v for v in LABEL_MAP.values() if v):
        test_ents = [sp[3] for sp in all_spans(*vm['test']) if sp[0] == t]
        unseen = [x for x in test_ents if x not in train_surface]
        covered_unseen = [x for x in unseen if x in vi_surface[t]]
        coverage[t] = {
            'vi_ner_train': stats['vi_ner']['train']['entity_spans'].get(t, 0),
            'vietmed_train': stats['vietmed_ner']['train']['entity_spans'].get(t, 0),
            'vi_ner_train_distinct_surfaces': len(vi_surface[t]),
            'vietmed_test': len(test_ents),
            'vietmed_test_covered': sum(x in vi_surface[t] for x in test_ents),
            'vietmed_test_unseen': len(unseen),
            'vietmed_test_unseen_covered': len(covered_unseen),
            'covered_unseen_examples': [x for x, _ in Counter(covered_unseen).most_common(8)],
        }
    changed = sum(normalize([x]) != x for s in vi for w in vi[s][0] for x in w)
    n_vi_tok = sum(stats['vi_ner'][s]['tokens'] for s in vi)
    return {'label_map': LABEL_MAP, 'stats': stats, 'vi_ner_duplicates': dup,
            'vietmed_sentences_found_in_vi_ner': cross, 'type_coverage': coverage,
            'tokens_changed_by_normalization_share': changed / n_vi_tok}
