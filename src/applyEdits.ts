import * as vscode from 'vscode';
import { findRichNodes, getPropertyValueRange } from './yamlService';
// Task 19: LaTeX -> MathJSON stub adapter
import { latexToMathJSON } from './mathjsonAdapter';

/** Shape of edit:apply messages sent from webviews/insets */
export interface RichEditMessage {
  path: Array<string|number>;            // Node path within parsed YAML
  key?: string;                          // Simple property key (e.g., 'latex') legacy mode
  propPath?: string[];                   // Nested property path under node (e.g., ['encoding','x','field'])
  edit?: 'set';                          // Only 'set' for now
  value: any;                            // New scalar/string value
}

/** Apply an edit:apply message to the given document. Mirrors prior InlinePreviewController.applyInlineEdit logic. */
export async function applyRichNodeEdit(doc: vscode.TextDocument, msg: RichEditMessage): Promise<boolean> {
  try {
    if (!msg || !Array.isArray(msg.path)) return false;
    const nodePath = msg.path;
    const propPath: string[] | undefined = Array.isArray(msg.propPath) ? msg.propPath : undefined;
    const editKind = String(msg.edit || 'set');
    if (editKind !== 'set') return false;
    const value = msg.value;
    const fullText = doc.getText();

    // Lightweight validation for certain chart edits
    if (propPath && propPath.length) {
      const top = propPath[0];
      if (top === 'mark') {
        const allowed = new Set(['line','bar','point']);
        if (!allowed.has(String(value).toLowerCase())) return false; // ignore invalid
      }
      if (top === 'encoding' && propPath.length >= 3 && propPath[2] === 'type') {
        const allowedTypes = new Set(['quantitative','nominal','temporal','ordinal']);
        if (!allowedTypes.has(String(value).toLowerCase())) return false;
      }
    }

    const wsEdit = new vscode.WorkspaceEdit();

    // Validate that the target node still exists at the given path; if not, attempt a simple structural fallback.
    const nodesNow = findRichNodes(fullText);
    const pathKey = JSON.stringify(nodePath);
    let targetNode = nodesNow.find(n => JSON.stringify(n.path) === pathKey);
    if (!targetNode) {
      // Fallback: pick first node with same tag as implied by edit context (heuristic: if editing 'latex' assume equation, else if propPath starts with encoding/mark/title assume chart)
      const isEquationEdit = (msg.key === 'latex') || (propPath && propPath[0] === 'latex');
      const candidateTag = isEquationEdit ? '!equation' : '!chart';
      const sameTag = nodesNow.filter(n => n.tag === candidateTag);
      if (sameTag.length === 1) {
        targetNode = sameTag[0];
      } else {
        // Could add distance heuristic later; for now treat as stale path -> skip edit
        return false;
      }
    }

    if (!propPath || propPath.length === 0) {
      // Simple top-level property (common case: equation.latex). Accept non-string scalars.
      const key = typeof msg.key === 'string' ? msg.key : 'latex';
      const range = getPropertyValueRange(fullText, targetNode.path, key);
      const serialized = serializeYamlScalar(value);
      if (range) {
        wsEdit.replace(doc.uri, new vscode.Range(doc.positionAt(range.start), doc.positionAt(range.end)), serialized);
      } else {
        const insertPos = doc.positionAt(targetNode.range.start);
        const indent = '  ';
        wsEdit.insert(doc.uri, insertPos.translate(1, 0), `\n${indent}${key}: ${serialized}`);
      }
      // Task 19: If editing latex for an !equation node, also update (or insert) mathjson using stub adapter.
      if (key === 'latex' && targetNode.tag === '!equation') {
        try {
          // Extract overrides (if present) from existing text.
          let overrides: string[] | undefined;
          try {
            const nodeText = fullText.slice(targetNode.range.start, targetNode.range.end);
            // Simple regex to capture override lines: override: [G, h] OR override: G
            const oMatch = nodeText.match(/override:\s*(.*)/);
            if (oMatch) {
              const raw = oMatch[1].trim();
              if (raw.startsWith('[')) {
                const list = raw.replace(/[#].*/, '').replace(/\]/, '').replace(/\[/, '');
                overrides = list.split(/[,\s]/).map(s => s.trim()).filter(Boolean);
              } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
                overrides = [raw];
              }
            }
          } catch {}
          const mj = latexToMathJSON(String(value || ''), overrides);
          const mjRange = getPropertyValueRange(fullText, targetNode.path, 'mathjson');
          const mjSerialized = serializeInlineObject(mj);
          if (mjRange) {
            wsEdit.replace(doc.uri, new vscode.Range(doc.positionAt(mjRange.start), doc.positionAt(mjRange.end)), mjSerialized);
          } else {
            const insertPos2 = doc.positionAt(targetNode.range.start);
            const indent2 = '  ';
            wsEdit.insert(doc.uri, insertPos2.translate(1, 0), `\n${indent2}mathjson: ${mjSerialized}`);
          }
        } catch (e) {
          console.warn('[RichYAML] mathjson generation failed (stub)', e);
        }
      }
    } else {
      // Nested edits (e.g., chart encoding updates)
      const [topKey, ...rest] = propPath;
      const topRange = getPropertyValueRange(fullText, targetNode.path, topKey);
      if (!rest.length) {
        if (topRange) {
          const start = doc.positionAt(topRange.start);
          const end = doc.positionAt(topRange.end);
          wsEdit.replace(doc.uri, new vscode.Range(start, end), serializeYamlScalar(value));
        } else {
          const insertPos = doc.positionAt(targetNode.range.start);
          const indent = '  ';
          const insertText = `\n${indent}${topKey}: ${serializeYamlScalar(value)}`;
          wsEdit.insert(doc.uri, insertPos.translate(1, 0), insertText);
        }
      } else {
        const indent = '  ';
        const snippet = (keys: string[], finalValue: unknown) => {
          let s = '';
          for (let i = 0; i < keys.length - 1; i++) s += `\n${indent.repeat(i+1)}${keys[i]}:`;
          const lastKey = keys[keys.length - 1];
            const scalar = serializeYamlScalar(finalValue);
          s += `\n${indent.repeat(keys.length)}${lastKey}: ${scalar}`;
          return s;
        };
        if (!topRange) {
          // Insert whole chain under targetNode
          const anchorPos = doc.positionAt(targetNode.range.start);
          wsEdit.insert(doc.uri, anchorPos.translate(1,0), snippet(propPath, value));
        } else if (rest.length === 1) {
          const subKey = rest[0];
          const subRange = getPropertyValueRange(fullText, targetNode.path.concat(topKey as any), subKey);
          if (subRange) {
            wsEdit.replace(doc.uri, new vscode.Range(doc.positionAt(subRange.start), doc.positionAt(subRange.end)), serializeYamlScalar(value));
          } else {
            const topStart = doc.positionAt(topRange.start);
            wsEdit.insert(doc.uri, topStart.translate(1,0), `\n${indent}${subKey}: ${serializeYamlScalar(value)}`);
          }
        } else {
          const pathToFirst = targetNode.path.concat(topKey as any);
          const firstExists = getPropertyValueRange(fullText, pathToFirst, rest[0]);
          if (!firstExists) {
            const topStart = doc.positionAt(topRange.start);
            wsEdit.insert(doc.uri, topStart.translate(1,0), `\n${indent}${rest[0]}:\n${indent.repeat(2)}${rest[1]}: ${serializeYamlScalar(value)}`);
          } else if (rest.length === 2) {
            const fieldRange = getPropertyValueRange(fullText, pathToFirst.concat(rest[0] as any), rest[1]);
            if (fieldRange) {
              wsEdit.replace(doc.uri, new vscode.Range(doc.positionAt(fieldRange.start), doc.positionAt(fieldRange.end)), serializeYamlScalar(value));
            } else {
              const firstStart = doc.positionAt((firstExists as any).start);
              wsEdit.insert(doc.uri, firstStart.translate(1,0), `\n${indent}${rest[1]}: ${serializeYamlScalar(value)}`);
            }
          }
        }
      }
    }

    if (wsEdit.size === 0) return false;
    await vscode.workspace.applyEdit(wsEdit);
    return true;
  } catch (e) {
    console.error('[RichYAML] applyRichNodeEdit failed', e);
    return false;
  }
}

// YAML scalar serialization helper (keeps prior JSON-style quoting behavior)
function serializeYamlScalar(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return 'null'; }
}

function serializeInlineObject(obj: any): string {
  try { return JSON.stringify(obj); } catch { return '{}'; }
}
