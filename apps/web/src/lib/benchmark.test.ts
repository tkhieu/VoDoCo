import { describe, expect, it } from 'vitest';
import comparison from '../../../../do_an_may_hoc/results/model_comparison.json';
import { benchmarkRows, exactPercent } from './benchmark';
import { nerModels } from './api';

const sourceNames = [
  'Logistic Regression',
  'Linear SVM',
  'CRF',
  'XLM-R',
  'PhoBERT',
  'ViHealthBERT',
] as const;

function referencePercent(value: number): string {
  const [integer, fraction = ''] = String(value).split('.');
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(`${integer}${fraction}`) * 100n;
  const whole = scaled / scale;
  const remainder = (scaled % scale).toString().padStart(fraction.length, '0').replace(/0+$/, '');
  return `${whole}${remainder ? `,${remainder}` : ''}%`;
}


describe('six-model benchmark', () => {
  it('keeps ladder order and reads every value from the canonical result JSON', () => {
    expect(benchmarkRows.map(row => row.model)).toEqual([...nerModels]);
    benchmarkRows.forEach((row, index) => {
      const source = comparison.models[sourceNames[index]];
      expect(row).toEqual({
        model: nerModels[index],
        testF1: source.test_f1,
        ci95: source.test_f1_ci95,
        recallUnseen: source.recall_unseen,
      });
    });
  });

  it('renders every canonical metric by exact decimal shift without floating-point digits', () => {
    const values = benchmarkRows.flatMap(row => [row.testF1, ...row.ci95, row.recallUnseen]);
    expect(values.map(exactPercent)).toEqual(values.map(referencePercent));
    expect(exactPercent(comparison.models['Logistic Regression'].test_f1))
      .toBe('56,22630504520268%');
    expect(exactPercent(comparison.models.CRF.test_f1)).toBe('63,79640496633516%');
  });
});
