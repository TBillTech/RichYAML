import * as vscode from 'vscode';
import { renderChartToSvgDataUri, VegaLikeSpec } from './chartRender';

type PathKey = string; // JSON.stringify(path)

type CacheEntry = {
  version: number; // document version at render time
  svgUri: string; // data:image/svg+xml;base64,...
};

class ChartSvgCache {
  // docUri -> (pathKey -> entry)
  private byDoc = new Map<string, Map<PathKey, CacheEntry>>();

  invalidateDoc(docUri: string) {
    this.byDoc.delete(docUri);
  }

  invalidateAll() {
    this.byDoc.clear();
  }

  async getOrRender(
    docUri: string,
    docVersion: number,
    path: Array<string | number>,
    spec: VegaLikeSpec,
    values?: any[],
    width?: number,
    height?: number
  ): Promise<string | undefined> {
    const key = JSON.stringify(path);
    const perDoc = this.byDoc.get(docUri);
    const hit = perDoc?.get(key);
    if (hit && hit.version === docVersion) return hit.svgUri;
    // Render fresh and store
  let uri: string | undefined;
    try {
      uri = await renderChartToSvgDataUri(spec, values, width, height);
    } catch (e: any) {
      // Swallow cancellation-like errors during shutdown; rethrow others for hover to show message.
      const msg = String(e?.message || e || '');
      if (/canceled|cancelled|disposed|aborted/i.test(msg)) return undefined;
      throw e;
    }
    if (!uri) return undefined;
    const map = perDoc ?? new Map<PathKey, CacheEntry>();
    map.set(key, { version: docVersion, svgUri: uri });
    if (!perDoc) this.byDoc.set(docUri, map);
    return uri;
  }
}

const singleton = new ChartSvgCache();

export function registerChartCache(context: vscode.ExtensionContext) {
  // Invalidate cache whenever a document changes (cheap and safe)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      try { singleton.invalidateDoc(e.document.uri.toString()); } catch {}
    })
  );
  // Invalidate on close to free memory
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      try { singleton.invalidateDoc(doc.uri.toString()); } catch {}
    })
  );
}

export function getChartCache() {
  return singleton;
}
