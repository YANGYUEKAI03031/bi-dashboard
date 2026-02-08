// src/services/dataCache.ts
export interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

export class DataCache {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTTL = 5 * 60 * 1000;
  
  set(key: string, data: any, ttl: number = this.defaultTTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
  
  get(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  static generateKey(config: any): string {
    return JSON.stringify(config);
  }
}