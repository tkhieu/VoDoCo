"""Descriptive statistics of a BIO-tagged corpus used by the EDA section of the notebook.

Every function takes `data = {split: (sentences, tag_rows)}` (lists of syllable lists / BIO tag lists)
and returns plain dicts that are written as JSON into results/.
"""
import re
from collections import Counter, defaultdict

import numpy as np
from seqeval.metrics.sequence_labeling import get_entities


def spans(words, tags):
    """(type, start, end, surface) for every entity; `end` is inclusive like seqeval."""
    return [(t, s, e, ' '.join(words[s:e + 1])) for t, s, e in get_entities(tags)]


def all_spans(words_list, tags_list):
    return [sp for w, t in zip(words_list, tags_list) for sp in spans(w, t)]


def describe(val):
    a = np.asarray(val, dtype=float)
    return {'mean': float(a.mean()), 'median': float(np.median(a)), 'p95': float(np.percentile(a, 95)), 'max': float(a.max())}


# ------------------------------------------------------------------ class distribution and shift
def class_distribution(data, rare_threshold=50):
    """Counts per type, imbalance ratio, and how many F1 points one entity is worth for each type in test."""
    counts = {s: Counter(t for t, *_ in all_spans(*data[s])) for s in data}
    types = sorted(counts['train'], key=counts['train'].get, reverse=True)
    types += sorted({t for c in counts.values() for t in c} - set(types))
    rows = {}
    for t in types:
        n_train, n_test = counts['train'][t], counts['test'][t]
        rows[t] = {'train': n_train, 'validation': counts['validation'][t], 'test': n_test,
                   'rare': n_train < rare_threshold,
                   # recall moves by 100/n points when one more test entity of this type is found or missed
                   'test_points_per_entity': 100 / n_test if n_test else None}
    head = types[0]
    tail = [t for t in types if counts['train'][t] > 0][-1]  # types absent from train have no finite ratio
    return {'per_type': rows, 'rare_threshold': rare_threshold,
            'rare_types': [t for t in types if rows[t]['rare']],
            'largest': head, 'smallest': tail,
            'imbalance_ratio': counts['train'][head] / counts['train'][tail]}


def per_type_shift(data):
    """Share of each type per split, test/train share ratio, and per-type unseen-surface rate."""
    train_surface = {sp[3] for sp in all_spans(*data['train'])}
    out = {}
    split_spans = {s: all_spans(*data[s]) for s in data}
    totals = {s: len(v) for s, v in split_spans.items()}
    types = sorted({sp[0] for v in split_spans.values() for sp in v})
    for t in types:
        row = {}
        for s, v in split_spans.items():
            of_type = [sp for sp in v if sp[0] == t]
            row[f'{s}_share'] = len(of_type) / totals[s]
            if s != 'train':
                row[f'{s}_unseen_rate'] = (sum(sp[3] not in train_surface for sp in of_type) / len(of_type)) if of_type else None
                row[f'{s}_n'] = len(of_type)
        row['test_over_train_share'] = row['test_share'] / row['train_share'] if row['train_share'] else None
        out[t] = row
    overall = {s: sum(sp[3] not in train_surface for sp in split_spans[s]) / totals[s] for s in data if s != 'train'}
    return {'per_type': out, 'overall_unseen_rate': overall}


# ------------------------------------------------------------------ entity length
def entity_length(data):
    out = {}
    for s, (words, tags) in data.items():
        by_type = defaultdict(list)
        for t, a, b, _ in all_spans(words, tags):
            by_type[t].append(b - a + 1)
        every = [x for v in by_type.values() for x in v]
        hist = Counter(every)
        out[s] = {'overall': {**describe(every), 'histogram': {str(k): hist[k] for k in sorted(hist)},
                              'share_ge5': sum(x >= 5 for x in every) / len(every)},
                  'per_type': {t: {**describe(v), 'n': len(v)} for t, v in sorted(by_type.items())}}
    return out


# ------------------------------------------------------------------ split overlap and duplicates
def _ngrams(tokens, n):
    return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def split_overlap(data, n=8, threshold=0.5):
    """Exact duplicates inside and across splits, plus near duplicates of a single train sentence.

    A sentence is a near duplicate when at least `threshold` of its n-grams occur in one and the same train
    sentence (n-grams spread over unrelated train sentences do not add up). Examples are sentence indices of
    the first split, so no dataset text is written to JSON.
    """
    text = {s: [' '.join(w) for w in data[s][0]] for s in data}
    out = {'within_split_duplicates': {s: len(v) - len(set(v)) for s, v in text.items()}}
    cross = {}
    for a, b in (('validation', 'train'), ('test', 'train'), ('test', 'validation')):
        ref = set(text[b])
        hits = [i for i, x in enumerate(text[a]) if x in ref]
        cross[f'{a}_in_{b}'] = {'count': len(hits), 'indices': hits[:5]}
    out['cross_split_exact'] = cross
    index = defaultdict(set)  # n-gram -> ids of the train sentences containing it
    for i, w in enumerate(data['train'][0]):
        for g in _ngrams(w, n):
            index[g].add(i)
    near = {}
    for s in ('validation', 'test'):
        shares, hits = [], []
        for j, w in enumerate(data[s][0]):
            g = _ngrams(w, n)
            if not g:
                continue
            per_train = Counter(i for x in g for i in index.get(x, ()))
            share = max(per_train.values(), default=0) / len(g)
            shares.append(share)
            if share >= threshold:
                hits.append(j)
        near[s] = {'sentences_with_ngrams': len(shares), 'near_duplicates': len(hits), 'indices': hits[:5]}
    out['near_duplicate_of_train'] = {'ngram': n, 'threshold': threshold, 'unit': 'single train sentence', **near}
    return out


# ------------------------------------------------------------------ label inconsistency
def label_inconsistency(words_list, tags_list, top=10):
    """Same surface string annotated with several types, and annotated strings that also occur untagged."""
    surf_types = defaultdict(Counter)
    for t, _, _, surf in all_spans(words_list, tags_list):
        surf_types[surf][t] += 1
    conflicts = {s: c for s, c in surf_types.items() if len(c) > 1}
    by_len = defaultdict(set)
    for s in surf_types:
        by_len[len(s.split())].add(s)
    untagged = Counter()
    for words, tags in zip(words_list, tags_list):
        for n, cand in by_len.items():
            for i in range(len(words) - n + 1):
                if all(t == 'O' for t in tags[i:i + n]):
                    s = ' '.join(words[i:i + n])
                    if s in cand:
                        untagged[s] += 1
    tagged_n = {s: sum(c.values()) for s, c in surf_types.items()}
    # stray: a string that is almost always plain text but was tagged once or twice (likely annotation slips);
    # ambiguous: tagged and untagged several times each (context-dependent or inconsistent annotation).
    # Only strings of >= 2 syllables are classified: a single syllable is often a different word in context
    # ("cơ" in "cơ thể" vs the organ "cơ"), so single-syllable counts are reported separately as an upper bound.
    multi = {s: n for s, n in untagged.items() if len(s.split()) >= 2}
    single = {s: n for s, n in untagged.items() if len(s.split()) == 1}
    stray = {s: n for s, n in multi.items() if tagged_n[s] <= 2 and n >= 20}
    ambiguous = {s: n for s, n in multi.items() if tagged_n[s] >= 3 and n >= 3}
    single_ambiguous = {s: n for s, n in single.items() if tagged_n[s] >= 3 and n >= 3}

    def ex(d, key):
        return [{'surface': s, 'tagged': tagged_n[s], 'untagged': n, 'types': dict(surf_types[s])}
                for s, n in sorted(d.items(), key=key)[:top]]

    return {
        'distinct_surfaces': len(surf_types),
        'type_conflict': {'surfaces': len(conflicts), 'share_of_surfaces': len(conflicts) / len(surf_types),
                          'occurrences': sum(sum(c.values()) for c in conflicts.values()),
                          'examples': [{'surface': s, 'types': dict(c)} for s, c in
                                       sorted(conflicts.items(), key=lambda kv: -sum(kv[1].values()))[:top]]},
        'tagged_vs_untagged': {
            'surfaces': len(untagged), 'untagged_occurrences': sum(untagged.values()),
            'stray': {'surfaces': len(stray), 'tagged_occurrences': sum(tagged_n[s] for s in stray),
                      'examples': ex(stray, lambda kv: -kv[1])},
            'ambiguous': {'surfaces': len(ambiguous), 'tagged_occurrences': sum(tagged_n[s] for s in ambiguous),
                          'untagged_occurrences': sum(ambiguous.values()),
                          'examples': ex(ambiguous, lambda kv: -min(kv[1], tagged_n[kv[0]]))},
            'single_syllable_upper_bound': {'surfaces': len(single_ambiguous),
                                            'examples': ex(single_ambiguous, lambda kv: -min(kv[1], tagged_n[kv[0]]))}},
    }


# ------------------------------------------------------------------ text noise heuristics
FILLERS = {'ờ', 'ừ', 'ừm', 'ưm', 'ơ', 'ờm', 'à', 'ạ', 'hả', 'nhé', 'nhỉ', 'vâng', 'dạ', 'nha', 'hen'}
NUMBER_WORDS = {'không', 'một', 'hai', 'ba', 'bốn', 'tư', 'năm', 'sáu', 'bảy', 'bẩy', 'tám', 'chín', 'mười', 'mươi',
                'trăm', 'nghìn', 'ngàn', 'triệu', 'tỷ', 'tỉ', 'lăm', 'mốt', 'linh', 'lẻ', 'rưỡi'}
# An ASCII token is treated as a Vietnamese syllable only if it parses as initial + one vowel group + final.
VI_SYLLABLE = re.compile(r'^(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdghklmnprstvx])?[aeiouy]+(ch|ng|nh|[cmnpt])?$')


def is_foreign(token):
    return token.isascii() and token.isalpha() and not VI_SYLLABLE.match(token)


def text_noise(data, top=15):
    out = {}
    for s, (words, tags) in data.items():
        n_tok = sum(len(w) for w in words)
        fillers, foreign, foreign_types = Counter(), Counter(), Counter()
        filler_sents = number_spans = number_span_in_entity = digit_tokens = 0
        for w, t in zip(words, tags):
            f = [x for x in w if x in FILLERS]
            fillers.update(f)
            filler_sents += bool(f)
            digit_tokens += sum(any(c.isdigit() for c in x) for x in w)
            i = 0
            while i < len(w):
                j = i
                while j < len(w) and w[j] in NUMBER_WORDS:
                    j += 1
                if j - i >= 2:  # two or more number words in a row, e.g. "năm mươi lăm"
                    number_spans += 1
                    number_span_in_entity += any(x != 'O' for x in t[i:j])
                i = max(j, i + 1)
            for x, tag in zip(w, t):
                if is_foreign(x):
                    foreign[x] += 1
                    foreign_types[tag.split('-', 1)[-1] if tag != 'O' else 'O'] += 1
        n_foreign = sum(foreign.values())
        out[s] = {
            'filler': {'sentence_share': filler_sents / len(words), 'token_share': sum(fillers.values()) / n_tok,
                       'top': dict(fillers.most_common(top))},
            'number_words': {'spans': number_spans, 'spans_per_100_sentences': 100 * number_spans / len(words),
                             'span_share_inside_entity': number_span_in_entity / number_spans if number_spans else 0,
                             'digit_tokens': digit_tokens},
            'foreign': {'distinct': len(foreign), 'occurrences': n_foreign, 'token_share': n_foreign / n_tok,
                        'share_inside_entity': 1 - foreign_types['O'] / n_foreign if n_foreign else 0,
                        'by_tag': dict(foreign_types.most_common()), 'top': dict(foreign.most_common(top))},
        }
    return out


# ------------------------------------------------------------------ subword lengths
def subword_lengths(sentences, tokenizer):
    """Length after first-subword alignment encoding: sum of per-syllable subwords + special tokens."""
    special = len(tokenizer.build_inputs_with_special_tokens([]))
    cache = {}
    lengths, per_word_max = [], 0
    for w in sentences:
        n = 0
        for x in w:
            if x not in cache:
                cache[x] = len(tokenizer.encode(x, add_special_tokens=False))
            n += cache[x]
            per_word_max = max(per_word_max, cache[x])
        lengths.append(n + special)
    return lengths, per_word_max


def subword_summary(lengths, limit):
    a = np.asarray(lengths)
    return {'mean': float(a.mean()), 'p99': float(np.percentile(a, 99)), 'max': int(a.max()),
            'over_128': int((a > 128).sum()), f'over_{limit}': int((a > limit).sum())}
