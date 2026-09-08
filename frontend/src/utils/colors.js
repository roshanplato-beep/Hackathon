/**
 * Heat risk score to color mapping.
 * Matches backend heat_engine.py exactly.
 */

export function getHeatColor(score) {
  if (score >= 80) return '#dc2626';
  if (score >= 65) return '#ea580c';
  if (score >= 50) return '#d97706';
  if (score >= 35) return '#ca8a04';
  if (score >= 20) return '#65a30d';
  return '#16a34a';
}

export function getHeatColorRgba(score, alpha = 0.55) {
  if (score >= 80) return `rgba(220, 38, 38, ${alpha})`;
  if (score >= 65) return `rgba(234, 88, 12, ${alpha})`;
  if (score >= 50) return `rgba(217, 119, 6, ${alpha})`;
  if (score >= 35) return `rgba(202, 138, 4, ${alpha})`;
  if (score >= 20) return `rgba(101, 163, 13, ${alpha})`;
  return `rgba(22, 163, 74, ${alpha})`;
}

export function getRiskLabel(score) {
  if (score >= 75) return 'Critical';
  if (score >= 55) return 'High';
  if (score >= 35) return 'Moderate';
  return 'Low';
}

export function getRiskBadgeColor(level) {
  switch (level) {
    case 'Critical': return { bg: '#991b1b', text: '#fca5a5' };
    case 'High': return { bg: '#9a3412', text: '#fdba74' };
    case 'Moderate': return { bg: '#854d0e', text: '#fde047' };
    case 'Low': return { bg: '#166534', text: '#86efac' };
    default: return { bg: '#374151', text: '#d1d5db' };
  }
}

export const CATEGORY_COLORS = {
  green: '#22c55e',
  cool_surface: '#3b82f6',
  water: '#06b6d4',
};

export const CATEGORY_LABELS = {
  green: 'Green Infrastructure',
  cool_surface: 'Cool Surfaces',
  water: 'Water-Based',
};
