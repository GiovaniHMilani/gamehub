/** Shown until the first snapshot and the game list have arrived: the shape of what is coming. */
export function LoadingPanel() {
  return (
    <div className="screen" aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Loading your library…</p>
      <div className="game-grid" aria-hidden="true">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </div>
  )
}
