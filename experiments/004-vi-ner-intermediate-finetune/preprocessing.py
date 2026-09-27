import unicodedata

MAX_LENGTH = 256


def normalize_row(tokens, tags):
    if len(tokens) != len(tags):
        raise ValueError("Token/tag lengths differ")
    words, labels = [], []
    for token, tag in zip(tokens, tags):
        word = str(token).lower().strip()
        if not word or all(unicodedata.category(char).startswith("P") for char in word):
            continue
        tag = "O" if tag == "0" else str(tag)
        if tag.startswith("I-") and (not labels or labels[-1] not in {"B-" + tag[2:], tag}):
            tag = "B-" + tag[2:]
        words.append(word)
        labels.append(tag)
    return {"words": words, "tags": labels}


def sentence_key(words):
    return " ".join(words)


def prepare_vi_ner(splits, heldout_keys):
    output = {}
    log = {}
    test_keys = {sentence_key(normalize_row(r["tokens"], r["ner_tags"])["words"])
                 for r in splits["test"]}
    seen = set()
    for name in ("validation", "train"):
        counts = {"input": 0, "empty": 0, "duplicate": 0,
                  "vi_ner_test_overlap": 0, "vietmed_heldout_overlap": 0}
        rows = []
        for raw in splits[name]:
            counts["input"] += 1
            row = normalize_row(raw["tokens"], raw["ner_tags"])
            key = sentence_key(row["words"])
            if not key:
                counts["empty"] += 1
            elif key in heldout_keys:
                counts["vietmed_heldout_overlap"] += 1
            elif key in test_keys:
                counts["vi_ner_test_overlap"] += 1
            elif key in seen:
                counts["duplicate"] += 1
            else:
                rows.append(row)
                seen.add(key)
        counts["kept"] = len(rows)
        output[name] = rows
        log[name] = counts
    return output, log


def encode_words(words, tags, tokenizer, label2id):
    raw_ids, raw_word_ids, raw_labels = [], [], []
    for index, word in enumerate(words):
        ids = tokenizer.encode(word, add_special_tokens=False)
        if not ids:
            continue
        raw_ids.extend(ids)
        raw_word_ids.extend([index] * len(ids))
        raw_labels.extend([label2id[tags[index]]] + [-100] * (len(ids) - 1))
    input_ids = tokenizer.build_inputs_with_special_tokens(raw_ids)
    start = next((i for i in range(len(input_ids) - len(raw_ids) + 1)
                  if input_ids[i:i + len(raw_ids)] == raw_ids), None)
    if start is None:
        raise ValueError("Could not locate raw tokens in special-token sequence")
    input_ids = input_ids[:MAX_LENGTH]
    labels = [-100] * len(input_ids)
    word_ids = [None] * len(input_ids)
    for offset, position in enumerate(range(start, min(start + len(raw_ids), len(input_ids)))):
        labels[position] = raw_labels[offset]
        word_ids[position] = raw_word_ids[offset]
    return {"input_ids": input_ids, "attention_mask": [1] * len(input_ids), "labels": labels}, word_ids
