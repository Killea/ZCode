import { useEffect, useMemo, useState } from "react";
import type { IMemoryService } from "@zcode/services";
import { useOptionalServices } from "@/hooks/useServices.js";

const EMPTY_MEMORY_NAMES: ReadonlyMap<string, string> = new Map();
const MEMORY_NAME_CACHE_TTL_MS = 30_000;

interface MemoryNameCacheEntry {
  expiresAt: number;
  inflight: Promise<ReadonlyMap<string, string>> | null;
  names: ReadonlyMap<string, string> | null;
}

// 消息流里同一批记忆会被多行历史消息同时回显；逐行 list 会重复扫描目录或走远端代理。
// 按 service 身份隔离缓存，避免本地与远端 Host 的名字串用。
const memoryNameCache = new WeakMap<IMemoryService, MemoryNameCacheEntry>();

function loadGlobalMemoryNames(service: IMemoryService): Promise<ReadonlyMap<string, string>> {
  const now = Date.now();
  const cached = memoryNameCache.get(service);
  if (cached?.names && cached.expiresAt > now) return Promise.resolve(cached.names);
  if (cached?.inflight) return cached.inflight;

  const inflight = service
    .listGlobalMemories()
    .then((entries) => {
      const names = new Map(entries.map((entry) => [entry.id, entry.name]));
      memoryNameCache.set(service, {
        names,
        expiresAt: Date.now() + MEMORY_NAME_CACHE_TTL_MS,
        inflight: null,
      });
      return names;
    })
    .catch((error: unknown) => {
      memoryNameCache.delete(service);
      throw error;
    });
  memoryNameCache.set(service, {
    names: cached?.names ?? null,
    expiresAt: cached?.expiresAt ?? 0,
    inflight,
  });
  return inflight;
}

/** 历史消息只保存记忆 id；展示名字按当前清单解析，已删除条目回退 id。 */
export function useGlobalMemoryDisplayNames(
  memoryIds: readonly string[],
): ReadonlyMap<string, string> {
  const services = useOptionalServices();
  const memoryService = services?.memoryService;
  const [names, setNames] = useState<ReadonlyMap<string, string>>(EMPTY_MEMORY_NAMES);
  const idsKey = memoryIds.join("\u0000");
  // idsKey 以内容而非数组引用作为依赖，避免行重渲染触发重复 load。
  const ids = useMemo(() => [...memoryIds], [idsKey]);

  useEffect(() => {
    if (!memoryService || ids.length === 0) return undefined;
    let cancelled = false;
    void loadGlobalMemoryNames(memoryService)
      .then((resolved) => {
        if (!cancelled) setNames(resolved);
      })
      .catch(() => {
        // 名字只是展示增强；读取失败保留 id 回退，不影响消息内容。
      });
    return () => {
      cancelled = true;
    };
  }, [memoryService, ids]);

  return names;
}
