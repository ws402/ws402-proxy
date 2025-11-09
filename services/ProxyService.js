// src/services/ProxyService.js
// Service for proxying original resources

const fetch = require('node-fetch');

class ProxyService {
  constructor(maskingService) {
    this.maskingService = maskingService;
    this.cache = new Map(); // Simple cache for hackathon
  }

  /**
   * Proxy a resource from original URL to client
   */
  async proxyResource(originalUrl, req, res) {
    try {
      console.log(`📡 Proxying resource: ${originalUrl}`);
      
      // Check cache (optional optimization)
      const cacheKey = this.getCacheKey(originalUrl);
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        console.log(`✅ Serving from cache`);
        return this.sendCached(cached, res);
      }
      
      // Fetch original resource
      const response = await fetch(originalUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'WS402-Proxy/1.0',
          // Forward some headers from client
          ...(req.headers.range && { 'Range': req.headers.range }),
        },
        timeout: 30000 // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch resource: ${response.status} ${response.statusText}`);
      }
      
      // Get content type
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      
      console.log(`✅ Resource fetched: ${contentType}`);
      
      // Set headers
      res.setHeader('Content-Type', contentType);
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      
      // Cache control
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      // Handle range requests (for video seeking)
      if (response.status === 206) {
        res.status(206);
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }
      }
      
      // Stream or buffer based on content type
      if (this.shouldStream(contentType)) {
        // Stream large files (videos, audio)
        response.body.pipe(res);
      } else {
        // Buffer small files (images, PDFs)
        const buffer = await response.buffer();
        
        // Cache if small enough
        if (buffer.length < 5 * 1024 * 1024) { // < 5MB
          this.cache.set(cacheKey, {
            buffer,
            contentType,
            timestamp: Date.now()
          });
          
          // Clear cache after 1 hour
          setTimeout(() => {
            this.cache.delete(cacheKey);
          }, 3600000);
        }
        
        res.send(buffer);
      }
      
    } catch (error) {
      console.error('❌ Proxy error:', error);
      
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Failed to proxy resource',
          message: error.message
        });
      }
    }
  }

  /**
   * Check if content should be streamed
   */
  shouldStream(contentType) {
    const streamTypes = [
      'video/',
      'audio/',
      'application/octet-stream'
    ];
    
    return streamTypes.some(type => contentType.startsWith(type));
  }

  /**
   * Generate cache key
   */
  getCacheKey(url) {
    return `cache_${Buffer.from(url).toString('base64').substring(0, 20)}`;
  }

  /**
   * Send cached response
   */
  sendCached(cached, res) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('X-Cache', 'HIT');
    res.send(cached.buffer);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      entries: this.cache.size,
      totalSize: Array.from(this.cache.values())
        .reduce((sum, item) => sum + (item.buffer?.length || 0), 0)
    };
  }
}

module.exports = ProxyService;
