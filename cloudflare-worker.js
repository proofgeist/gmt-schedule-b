/**
 * Cloudflare Worker: Census Schedule B CORS Proxy
 * 
 * This worker proxies requests to uscensus.prod.3ceonline.com and:
 * 1. Adds CORS headers to all responses
 * 2. Removes X-Frame-Options and CSP headers
 * 3. Injects URL-rewriting script into HTML responses
 * 
 * Deploy this worker and point your React app to it instead of the Census site.
 */

const TARGET_ORIGIN = 'https://uscensus.prod.3ceonline.com';
const TARGET_HOSTNAME = 'uscensus.prod.3ceonline.com';

// The interceptor script that gets injected into HTML responses
const INTERCEPTOR_SCRIPT = `<script>
(function() {
    const proxyPath = window.location.origin;
    const targetOrigin = 'uscensus.prod.3ceonline.com';
    
    const wrapUrl = (url) => {
        if (!url || typeof url !== 'string') return url;
        
        // Don't process URLs that already go through our proxy
        if (url.includes(window.location.host) && !url.includes(targetOrigin)) {
            return url;
        }
        
        // Handle protocol-relative URLs (//uscensus.prod.3ceonline.com/...)
        if (url.startsWith('//')) {
            if (url.includes(targetOrigin)) {
                const path = url.substring(url.indexOf(targetOrigin) + targetOrigin.length);
                return proxyPath + path;
            }
            return url;
        }
        
        // Handle absolute URLs with uscensus.prod.3ceonline.com
        if (url.includes(targetOrigin)) {
            try {
                const urlObj = new URL(url.startsWith('http') ? url : 'https:' + url);
                const pathname = urlObj.pathname || '/';
                const pathWithQuery = pathname + (urlObj.search || '') + (urlObj.hash || '');
                return proxyPath + pathWithQuery;
            } catch (e) {
                console.warn('URL parsing failed for:', url, e);
                return url;
            }
        }
        
        return url;
    };

    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let url, options;
        
        if (input instanceof Request) {
            url = wrapUrl(input.url);
            options = {
                method: input.method,
                headers: input.headers,
                body: input.body,
                mode: input.mode,
                credentials: input.credentials,
                cache: input.cache,
                redirect: input.redirect,
                referrer: input.referrer,
                integrity: input.integrity,
                ...init
            };
            return originalFetch(url, options);
        } else {
            url = wrapUrl(input);
            return originalFetch(url, init);
        }
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        const wrappedUrl = wrapUrl(url);
        return originalOpen.call(this, method, wrappedUrl, async, user, password);
    };
    
    console.log('Census proxy interceptor loaded - routing requests through', proxyPath);
})();
</script>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Build the target URL
    const targetUrl = TARGET_ORIGIN + url.pathname + url.search;
    
    // Create a new request to the target
    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow'
    });
    
    // Set proper origin header
    modifiedRequest.headers.set('Origin', TARGET_ORIGIN);
    
    try {
      // Fetch from the target
      const response = await fetch(modifiedRequest);
      
      // Get the response body
      const contentType = response.headers.get('content-type') || '';
      const isHtml = contentType.includes('text/html');
      
      let body;
      if (isHtml) {
        // For HTML, inject the interceptor script
        const htmlText = await response.text();
        body = htmlText.replace('<head>', '<head>' + INTERCEPTOR_SCRIPT);
      } else {
        // For other content, pass through
        body = response.body;
      }
      
      // Create new headers, removing problematic ones
      const newHeaders = new Headers(response.headers);
      newHeaders.delete('x-frame-options');
      newHeaders.delete('X-Frame-Options');
      newHeaders.delete('content-security-policy');
      newHeaders.delete('Content-Security-Policy');
      
      // Add CORS headers
      newHeaders.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      newHeaders.set('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Accept, Origin');
      newHeaders.set('Access-Control-Allow-Credentials', 'true');
      newHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Location');
      
      // Handle redirects
      const location = response.headers.get('location');
      if (location) {
        if (location.includes(TARGET_HOSTNAME)) {
          const newLocation = location.replace(
            new RegExp('https?://' + TARGET_HOSTNAME, 'g'),
            url.origin
          );
          newHeaders.set('location', newLocation);
        } else if (location.startsWith('/')) {
          newHeaders.set('location', url.origin + location);
        }
      }
      
      // Update content length for modified HTML
      if (isHtml) {
        newHeaders.set('Content-Length', new TextEncoder().encode(body).length);
      }
      
      // Return the modified response
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
      
    } catch (error) {
      return new Response('Proxy error: ' + error.message, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*'
        }
      });
    }
  }
};
