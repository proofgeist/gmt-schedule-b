import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from "vite-plugin-singlefile"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: {
    proxy: {
      '/census-proxy': {
        target: 'http://uscensus.prod.3ceonline.com',
        changeOrigin: true,
        cookieDomainRewrite: "localhost",
        rewrite: (path) => path.replace(/^\/census-proxy/, ''),
        configure: (proxy, options) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Remove headers that prevent framing
            delete proxyRes.headers['x-frame-options'];
            delete proxyRes.headers['content-security-policy'];

            // Handle redirects: if the Location header points to the census site, rewrite it to our proxy
            if (proxyRes.headers['location']) {
              proxyRes.headers['location'] = proxyRes.headers['location'].replace('https://uscensus.prod.3ceonline.com', req.headers.origin + '/census-proxy');
            }

            // Also handle CORS headers
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET, POST, OPTIONS, PUT, PATCH, DELETE';
            proxyRes.headers['access-control-allow-headers'] = 'X-Requested-With, content-type, Authorization';
          });
        }
      }
    }
  }
})
