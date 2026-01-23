function updateUsageStats() {
    // Mock data
    const stats = { endpoints: { test: { requests: 1, tokens: 100 } }, recent_logs: [] };
    const endpointDiv = { innerHTML: '' };

    for (const [name, data] of Object.entries(stats.endpoints || {})) {
        const count = typeof data === 'object' ? data.requests : data;
        const tokens = typeof data === 'object' ? data.tokens : 0;
        endpointDiv.innerHTML += `
            <div class="endpoint-row" style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                <span class="endpoint-name" style="font-weight: 500; font-family: monospace; color: var(--text);">${name}</span>
                <div style="text-align: right;">
                    <div style="font-weight: bold; color: var(--accent);">${count} reqs</div>
                    <div style="font-size: 0.65rem; color: var(--text-muted);">${tokens.toLocaleString()} tokens</div>
                </div>
            </div>
        `;
    }
}
