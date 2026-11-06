import { useDomainStore } from '../../stores/domain-store'

/** Read-only for now: how the app is doing, and the one limitation about logins worth knowing. */
export function SettingsScreen() {
  const games = useDomainStore((s) => s.games.length)
  const accounts = useDomainStore((s) => Object.keys(s.instancesById).length)
  const running = useDomainStore((s) => s.runningIds.length)
  const seq = useDomainStore((s) => s.seq)
  const resyncs = useDomainStore((s) => s.resyncs)

  return (
    <div className="screen screen-narrow">
      <section className="settings-section" aria-labelledby="settings-library">
        <h2 id="settings-library">Your library</h2>
        <dl className="settings-grid">
          <dt>Games</dt>
          <dd>{games}</dd>
          <dt>Accounts</dt>
          <dd>{accounts}</dd>
          <dt>Running</dt>
          <dd>{running}</dd>
        </dl>
      </section>

      <section className="settings-section" aria-labelledby="settings-sync">
        <h2 id="settings-sync">Connection</h2>
        <p className="prose">GameHub's window shows what the app reports as it happens; it never polls.</p>
        <dl className="settings-grid">
          <dt>Updates received</dt>
          <dd data-testid="settings-seq">{seq ?? 0}</dd>
          <dt>Times it had to resync</dt>
          <dd data-testid="settings-resyncs">{resyncs}</dd>
        </dl>
      </section>

      <section className="settings-section" aria-labelledby="settings-logins">
        <h2 id="settings-logins">Logins and saved data</h2>
        <p className="prose">
          Every account keeps its own cookies, storage and login, saved between runs. One browser rule to know: a cookie that
          has no expiry date is dropped when GameHub closes. Games that keep you signed in with a normal, lasting login are
          not affected.
        </p>
      </section>
    </div>
  )
}
