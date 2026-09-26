import comparison from '../../../../do_an_may_hoc/results/model_comparison.json';
import { nerModels, type Model } from './api';

const sourceName: Record<Model, keyof typeof comparison.models> = {
  logreg: 'Logistic Regression',
  'linear-svm': 'Linear SVM',
  crf: 'CRF',
  xlmr: 'XLM-R',
  phobert: 'PhoBERT',
  'vihealthbert-ner-seed2024': 'ViHealthBERT',
};

export type BenchmarkRow = {
  model: Model;
  testF1: number;
  ci95: readonly [number, number];
  recallUnseen: number;
};

export const benchmarkRows: readonly BenchmarkRow[] = nerModels.map(model => {
  const metrics = comparison.models[sourceName[model]];
  return {
    model,
    testF1: metrics.test_f1,
    ci95: [metrics.test_f1_ci95[0], metrics.test_f1_ci95[1]],
    recallUnseen: metrics.recall_unseen,
  };
});

export function exactPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Benchmark ratio must be between 0 and 1');
  if (value === 0) return '0%';
  if (value === 1) return '100%';
  const decimal = String(value);
  if (!decimal.startsWith('0.')) throw new RangeError('Benchmark ratio must use decimal notation');
  const digits = decimal.slice(2).padEnd(2, '0');
  const integer = digits.slice(0, 2).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(2);
  return `${integer}${fraction ? `,${fraction}` : ''}%`;
}
