export function PrivacyPolicy() {
  return (
    <div className="prose prose-invert">
      <p className="text-slate-400">Last Updated: August 2026</p>
      
      <h2>Data Collection</h2>
      <p>
        LevelUp stores all data locally on your device. We do not collect, 
        transmit, or store any personal data on external servers.
      </p>
      
      <h2>AI Features</h2>
      <p>
        Chat conversations are processed through OpenRouter API. No conversation 
        history is stored by our servers. All chat data remains on your device.
      </p>
      
      <h2>Permissions</h2>
      <ul>
        <li><strong>Internet</strong>: Required for AI chat functionality</li>
        <li><strong>Storage</strong>: Optional, for PDF viewing only</li>
      </ul>
      
      <h2>Contact</h2>
      <p>
        For privacy concerns, please open an issue on our GitHub repository.
      </p>
    </div>
  );
}
