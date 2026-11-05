import fs from "fs/promises";
import path from "path";
import { StorageProvider, StoredObjectRef } from "@/modules/storage/types";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

// DEVELOPMENT ADAPTER — filesystem-backed. Stands in for Google Cloud
// Storage locally. Never used when CASE_SHIELD_ENV=production; see
// google-cloud-storage.provider.ts for the production counterpart.
export class LocalStorageProvider implements StorageProvider {
  readonly name = "LocalStorageProvider (development)";
  readonly id = "local" as const;
  private readonly rootDir: string;

  constructor(rootDir: string = env.LOCAL_STORAGE_DIR) {
    this.rootDir = path.resolve(process.cwd(), "..", rootDir.replace(/^\.\//, ""));
  }

  private resolvePath(key: string): string {
    const root = path.resolve(this.rootDir);
    const resolved = path.resolve(root, key);
    // Must be strictly inside the root (a bare prefix check would accept a
    // sibling directory such as "storage-dev-evil").
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error("Refusing to write outside the storage root.");
    }
    return resolved;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<StoredObjectRef> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    logger.debug({ key }, "LocalStorageProvider: object written");
    return { provider: "local", key };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }
}
