import { get, list, put } from "@vercel/blob";

export type BlobStore = {
  list(prefix: string, signal?: AbortSignal): Promise<string[]>;
  read(pathname: string, signal?: AbortSignal): Promise<Buffer | null>;
  write(pathname: string, body: string | Buffer, signal?: AbortSignal, overwrite?: boolean): Promise<void>;
};

function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Use the authenticated SDK for both public and private stores. A missing object
// is different from an inaccessible store; callers must not erase data on error.
export function configuredBlobStore(sdk = { get, list, put }): BlobStore | undefined {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
  const access = process.env.BLOB_ACCESS || "public";
  if (access !== "public" && access !== "private") {
    throw new Error("Set BLOB_ACCESS to public or private to match your Vercel Blob store.");
  }
  return {
    async list(prefix, signal) {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await sdk.list({ prefix, cursor, limit: 1000, abortSignal: requestSignal(signal) });
        names.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
        if (page.hasMore && !cursor) throw new Error("Vercel Blob returned an incomplete collection listing.");
      } while (cursor);
      return names;
    },
    async read(pathname, signal) {
      const result = await sdk.get(pathname, {
        access,
        // Private storage supports consistent reads. Public scan files are
        // immutable, so CDN caching cannot return a previous version.
        ...(access === "private" ? { useCache: false } : {}),
        abortSignal: requestSignal(signal),
      });
      if (!result) return null;
      if (result.statusCode !== 200) throw new Error("Vercel Blob did not return the saved file.");
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async write(pathname, body, signal, overwrite = false) {
      await sdk.put(pathname, body, {
        access, addRandomSuffix: false, allowOverwrite: overwrite,
        abortSignal: requestSignal(signal),
      });
    },
  };
}
