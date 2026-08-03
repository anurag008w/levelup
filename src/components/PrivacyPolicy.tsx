export function PrivacyPolicy() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 text-sm leading-relaxed text-text">
      <p className="mb-6 text-xs text-muted-dim">Last Updated: August 2026</p>

      <h2 className="mb-2 mt-6 font-display text-lg font-bold text-text">Data Collection</h2>
      <p className="text-muted">
        LevelUp stores all data locally on your device. We do not collect,
        transmit, or store any personal data on external servers.
      </p>

      <h2 className="mb-2 mt-6 font-display text-lg font-bold text-text">AI Features</h2>
      <p className="text-muted">
        Chat conversations are processed through OpenRouter API. No conversation
        history is stored by our servers. All chat data remains on your device.
      </p>

      <h2 className="mb-2 mt-6 font-display text-lg font-bold text-text">Permissions</h2>
      <ul className="md-ul">
        <li className="md-li"><strong className="md-strong">Internet</strong>: Required for AI chat functionality</li>
        <li className="md-li"><strong className="md-strong">Storage</strong>: Optional, for PDF viewing only</li>
      </ul>

      <h2 className="mb-2 mt-6 font-display text-lg font-bold text-text">Contact</h2>
      <p className="text-muted">
        For privacy concerns, please open an issue on our GitHub repository.
      </p>
    </div>
  );
}
