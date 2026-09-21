import type { Schema } from './api';
export const labels: Record<Schema['Entity']['label'], string> = {
  AGE: 'Tuổi', DATETIME: 'Thời gian', DIAGNOSTICS: 'Chẩn đoán', DISEASESYMTOM: 'Bệnh / triệu chứng', DRUGCHEMICAL: 'Thuốc / hóa chất', FOODDRINK: 'Thực phẩm / đồ uống', GENDER: 'Giới tính', LOCATION: 'Địa điểm', MEDDEVICETECHNIQUE: 'Thiết bị / kỹ thuật y tế', OCCUPATION: 'Nghề nghiệp', ORGAN: 'Cơ quan', ORGANIZATION: 'Tổ chức', PERSONALCARE: 'Chăm sóc cá nhân', PREVENTIVEMED: 'Phòng ngừa', SURGERY: 'Phẫu thuật', TRANSPORTATION: 'Phương tiện', TREATMENT: 'Điều trị', UNITCALIBRATOR: 'Đơn vị / đo lường',
};
export type MappedEntity = Schema['Entity'] & { utf16Start: number | null; utf16End: number | null };
export function mapEntities(text: string, entities: Schema['Entity'][]): MappedEntity[] {
  const boundaries = [0];
  for (const point of text) boundaries.push(boundaries[boundaries.length - 1] + point.length);
  const mapped = entities.map(entity => {
    const { start, end } = entity;
    const valid = entity.offset_unit === 'unicode_codepoint' && start !== null && end !== null && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end < boundaries.length && text.slice(boundaries[start], boundaries[end]) === entity.text;
    return { ...entity, utf16Start: valid ? boundaries[start] : null, utf16End: valid ? boundaries[end] : null };
  });
  // Overlapping occurrences cannot each own a focusable inline span; disclose list-only rather than guessing.
  const ordered = mapped.filter(entity => entity.utf16Start !== null).sort((a, b) => a.utf16Start! - b.utf16Start!);
  const ambiguous = new Set<MappedEntity>();
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length && ordered[j].utf16Start! < ordered[i].utf16End!; j++) { ambiguous.add(ordered[i]); ambiguous.add(ordered[j]); }
  return mapped.map(entity => ambiguous.has(entity) ? { ...entity, utf16Start: null, utf16End: null } : entity);
}
