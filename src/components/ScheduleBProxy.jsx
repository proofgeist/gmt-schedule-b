import React, { useEffect, useRef, useState } from 'react';
import { callFMScript } from "@proofkit/webviewer";

const ScheduleBProxy = () => {
    const iframeRef = useRef(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [injectionsCount, setInjectionsCount] = useState(0);

    const handleSelect = (code, description) => {
        // Basic cleaning of the extracted data
        const cleanCode = code.replace(/[^\d.]/g, '').trim();
        const cleanDesc = description.trim();

        console.log('FileMaker Callback:', { code: cleanCode, description: cleanDesc });

        // Call FileMaker script as requested
        // "Handle Schedule B Callback" script with code and description parameter
        callFMScript("Handle Schedule B Callback", {
            code: cleanCode,
            description: cleanDesc,
            raw_code: code.trim()
        });
    };

    const injectButtons = (doc) => {
        // Find all rows in the results table
        // Based on research, rows are often tr.ng-scope in the Schedule B Search Engine
        const rows = doc.querySelectorAll('tr.ng-scope');
        let count = 0;

        rows.forEach(row => {
            // Check if we already injected a button in this row
            if (row.querySelector('.fm-select-btn-injected')) return;

            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
                // Schedule B Code is usually in the first TD
                // Description is in the second TD
                const code = cells[0].innerText;
                const description = cells[1].innerText;

                // Skip header rows or rows without useful codes
                if (!code || code.toLowerCase().includes('schedule b') || code.length < 2) return;

                // Create a new action cell
                const btnCell = doc.createElement('td');
                btnCell.style.padding = '5px';
                btnCell.style.textAlign = 'center';
                btnCell.style.verticalAlign = 'middle';

                const btn = doc.createElement('button');
                btn.innerText = 'SELECT';
                btn.className = 'fm-select-btn-injected';

                // Add click handler
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelect(code, description);
                };

                btnCell.appendChild(btn);

                // Insert at the beginning of the row
                row.insertBefore(btnCell, row.firstChild);
                count++;
            }
        });

        if (count > 0) {
            setInjectionsCount(prev => prev + count);
        }
    };

    const setupObserver = (iframe) => {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;

            // Inject Script to intercept network calls and redirect to proxy
            const script = doc.createElement('script');
            script.innerHTML = `
                (function() {
                    const proxyPath = window.location.origin + '/census-proxy';
                    const targetOrigin = 'uscensus.prod.3ceonline.com';
                    
                    const wrapUrl = (url) => {
                        if (typeof url === 'string' && url.includes(targetOrigin)) {
                            return url.replace(/^https?:\/\/uscensus\.prod\.3ceonline\.com/, proxyPath);
                        }
                        return url;
                    };

                    const originalFetch = window.fetch;
                    window.fetch = function() {
                        arguments[0] = wrapUrl(arguments[0]);
                        return originalFetch.apply(this, arguments);
                    };

                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function() {
                        arguments[1] = wrapUrl(arguments[1]);
                        return originalOpen.apply(this, arguments);
                    };
                })();
            `;
            doc.head.appendChild(script);

            // Inject CSS into iframe for the premium look button
            const style = doc.createElement('style');
            style.innerHTML = `
        .fm-select-btn-injected {
          background: linear-gradient(135deg, #0078d4 0%, #005a9e 100%);
          color: white;
          border: none;
          padding: 6px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          transition: all 0.2s ease;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .fm-select-btn-injected:hover {
          background: linear-gradient(135deg, #106ebe 0%, #005a9e 100%);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          transform: scale(1.05);
        }
      `;
            doc.head.appendChild(style);

            // Initial injection
            injectButtons(doc);

            // Observe changes to the body to handle dynamic content (Angular/SPA)
            const observer = new MutationObserver(() => {
                injectButtons(doc);
            });

            observer.observe(doc.body, {
                childList: true,
                subtree: true
            });

            setIsLoading(false);
            return () => observer.disconnect();
        } catch (e) {
            console.error("Iframe access blocked by browser security (CORS/CSP).", e);
            setError("Security Block: The Schedule B website (3ceonline.com) prohibits direct iframe interaction via CORS/CSP. " +
                "In FileMaker, ensure the WebViewer is configured to allow cross-origin interaction or load the app from a file.");
            setIsLoading(false);
        }
    };

    const onIframeLoad = () => {
        if (iframeRef.current) {
            setupObserver(iframeRef.current);
        }
    };

    return (
        <div className="proxy-container">
            <header className="proxy-header">
                <h1 className="proxy-title">Schedule B Search Broker</h1>
                <div className={`status-badge ${error ? 'error' : ''}`}>
                    {error ? '⚠ Connection Blocked' : (isLoading ? '⟳ Loading Engine...' : '✓ Active System')}
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    <strong>Security Limitation:</strong> {error}
                </div>
            )}

            <main className="iframe-wrapper">
                <iframe
                    ref={iframeRef}
                    src="/census-proxy/ui/"
                    className="schedule-b-iframe"
                    onLoad={onIframeLoad}
                    title="Schedule B Search Engine"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
            </main>
        </div>
    );
};

export default ScheduleBProxy;
