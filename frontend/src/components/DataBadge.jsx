/**
 * Marks a number as measured or modelled, with its source on hover.
 *
 * The app mixes satellite/OSM observations with model output, and those must
 * never look alike — a modelled surface temperature presented in the same style
 * as a measurement is the whole problem this component exists to prevent.
 */
export default function DataBadge({ kind, source, compact = false }) {
  const measured = kind === 'measured'
  return (
    <span
      className={`data-badge ${measured ? 'data-badge-measured' : 'data-badge-modelled'} ${
        compact ? 'data-badge-compact' : ''
      }`}
      title={source}
    >
      {measured ? 'Measured' : 'Modelled'}
    </span>
  )
}
