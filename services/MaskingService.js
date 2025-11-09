// src/services/MaskingService.js
// Service for managing masked URLs

const { nanoid } = require('nanoid');

class MaskingService {
  constructor() {
    // In-memory storage for hackathon
    // In production: use PostgreSQL/MongoDB
    this.resources = new Map();
    this.analytics = new Map();
  }

  /**
   * Create a new masked resource
   */
  async createMaskedResource(data) {
    const id = nanoid(10); // Short, unique ID
    
    // Detect resource type from URL
    const type = this.detectResourceType(data.originalUrl);
    
    const resource = {
      id,
      originalUrl: data.originalUrl,
      pricePerSecond: data.pricePerSecond,
      estimatedDuration: data.estimatedDuration,
      title: data.title,
      type,
      creatorWallet: data.creatorWallet,
      createdAt: data.createdAt || Date.now(),
      views: 0,
      totalEarnings: 0
    };
    
    this.resources.set(id, resource);
    
    // Initialize analytics
    this.analytics.set(id, {
      views: 0,
      totalSeconds: 0,
      totalEarnings: 0,
      sessions: []
    });
    
    console.log(`✅ Masked resource created: ${id}`);
    console.log(`   Original: ${data.originalUrl}`);
    console.log(`   Price: ${data.pricePerSecond} SOL/sec`);
    
    return resource;
  }

  /**
   * Get masked resource by ID
   */
  getResource(id) {
    return this.resources.get(id);
  }

  /**
   * Get all resources (for admin)
   */
  getAllResources() {
    return Array.from(this.resources.values());
  }

  /**
   * Get resources by creator wallet
   */
  getResourcesByCreator(creatorWallet) {
    return Array.from(this.resources.values())
      .filter(r => r.creatorWallet === creatorWallet);
  }

  /**
   * Update resource
   */
  updateResource(id, updates) {
    const resource = this.resources.get(id);
    if (!resource) {
      throw new Error('Resource not found');
    }
    
    Object.assign(resource, updates);
    this.resources.set(id, resource);
    
    return resource;
  }

  /**
   * Delete resource
   */
  deleteResource(id) {
    const deleted = this.resources.delete(id);
    if (deleted) {
      this.analytics.delete(id);
    }
    return deleted;
  }

  /**
   * Record analytics
   */
  recordView(id, sessionData) {
    const analytics = this.analytics.get(id);
    if (!analytics) return;
    
    analytics.views++;
    analytics.totalSeconds += sessionData.elapsedSeconds;
    analytics.totalEarnings += sessionData.consumedAmount;
    analytics.sessions.push({
      userId: sessionData.userId,
      duration: sessionData.elapsedSeconds,
      earned: sessionData.consumedAmount,
      timestamp: Date.now()
    });
    
    // Update resource
    const resource = this.resources.get(id);
    if (resource) {
      resource.views++;
      resource.totalEarnings = (resource.totalEarnings || 0) + sessionData.consumedAmount;
    }
  }

  /**
   * Get analytics for resource
   */
  getAnalytics(id) {
    const analytics = this.analytics.get(id);
    const resource = this.resources.get(id);
    
    if (!analytics || !resource) {
      return null;
    }
    
    return {
      resource: {
        id: resource.id,
        title: resource.title,
        createdAt: resource.createdAt
      },
      stats: {
        totalViews: analytics.views,
        totalWatchTime: analytics.totalSeconds,
        totalEarnings: analytics.totalEarnings,
        averageWatchTime: analytics.views > 0 
          ? analytics.totalSeconds / analytics.views 
          : 0,
        recentSessions: analytics.sessions.slice(-10) // Last 10
      }
    };
  }

  /**
   * Get resource count
   */
  getResourceCount() {
    return this.resources.size;
  }

  /**
   * Detect resource type from URL
   */
  detectResourceType(url) {
    const urlLower = url.toLowerCase();
    
    // Video platforms
    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
      return 'video/youtube';
    }
    if (urlLower.includes('vimeo.com')) {
      return 'video/vimeo';
    }
    if (urlLower.includes('twitch.tv')) {
      return 'video/twitch';
    }
    
    // File extensions
    if (urlLower.match(/\.(mp4|webm|mov|avi)$/)) {
      return 'video/file';
    }
    if (urlLower.match(/\.(mp3|wav|ogg)$/)) {
      return 'audio/file';
    }
    if (urlLower.match(/\.pdf$/)) {
      return 'document/pdf';
    }
    if (urlLower.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
      return 'image/file';
    }
    
    // API
    if (urlLower.includes('/api/')) {
      return 'api';
    }
    
    // Default
    return 'unknown';
  }

  /**
   * Validate URL
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Export data (for backup/migration)
   */
  exportData() {
    return {
      resources: Array.from(this.resources.entries()),
      analytics: Array.from(this.analytics.entries()),
      exportedAt: Date.now()
    };
  }

  /**
   * Import data (for restore)
   */
  importData(data) {
    this.resources = new Map(data.resources);
    this.analytics = new Map(data.analytics);
    console.log(`Imported ${this.resources.size} resources`);
  }
}

module.exports = MaskingService;
