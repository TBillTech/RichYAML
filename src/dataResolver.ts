import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';

/**
 * Resolve a data.file path relative to a document and parse into array of records.
 * Supports CSV, JSON, YAML. Truncates to maxPoints.
 */
export async function resolveDataFileRelative(docUri: vscode.Uri, filePath: string, maxPoints: number): Promise<any[]> {
	if (!filePath || typeof filePath !== 'string') throw new Error('Missing file');
	let p = filePath.trim();
	if (/^https?:/i.test(p)) throw new Error('Network URLs are not allowed');
	if (p.startsWith('file:')) p = p.slice('file:'.length);
	// Normalize separators
	p = p.replace(/\\/g, '/');
	const isAbs = path.isAbsolute(p);
	const baseDir = path.dirname(docUri.fsPath);
	const targetFs = isAbs ? p : path.join(baseDir, p);
	const targetFsResolved = path.resolve(targetFs);
	// Enforce workspace boundary unless opted out
	const allowOutside = !!vscode.workspace.getConfiguration('richyaml').get('security.allowDataOutsideWorkspace', false);
	const wsFolder = vscode.workspace.getWorkspaceFolder(docUri);
	if (wsFolder && !allowOutside) {
		const wsRoot = path.resolve(wsFolder.uri.fsPath) + path.sep;
		if (!targetFsResolved.startsWith(wsRoot)) {
			throw new Error('Data path must be inside the current workspace');
		}
	}
	const target = vscode.Uri.file(targetFsResolved);
	let buf: Uint8Array;
	try {
		buf = await vscode.workspace.fs.readFile(target);
	} catch (e: any) {
		throw new Error(`Unable to read ${p}: ${e?.message || e}`);
	}
	const ext = path.extname(target.fsPath).toLowerCase();
	let values: any[] = [];
	try {
		if (ext === '.csv') {
			values = parseCsvToObjects(new TextDecoder('utf-8').decode(buf));
		} else if (ext === '.json') {
			const text = new TextDecoder('utf-8').decode(buf);
			const data = JSON.parse(text);
			if (Array.isArray(data)) values = data;
			else if (data && Array.isArray((data as any).values)) values = (data as any).values;
			else throw new Error('JSON must be an array or an object with a values array');
		} else if (ext === '.yml' || ext === '.yaml') {
			const text = new TextDecoder('utf-8').decode(buf);
			const data = YAML.parse(text);
			if (Array.isArray(data)) values = data;
			else if (data && Array.isArray((data as any).values)) values = (data as any).values;
			else throw new Error('YAML must be an array or an object with a values array');
		} else {
			throw new Error(`Unsupported file type: ${ext || 'unknown'}`);
		}
	} catch (e: any) {
		throw new Error(`Parse error for ${p}: ${e?.message || e}`);
	}
	if (typeof maxPoints === 'number' && maxPoints >= 0 && values.length > maxPoints) {
		values = values.slice(0, maxPoints);
	}
	return values;
}

/** Minimal CSV parser: returns array of objects keyed by header row. */
export function parseCsvToObjects(text: string): any[] {
	const rows = parseCsvRows(text);
	if (!rows.length) return [];
	const header = rows[0];
	const out: any[] = [];
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		const obj: any = {};
		for (let j = 0; j < header.length; j++) {
			const k = String(header[j] ?? `col${j + 1}`);
			obj[k] = r[j] ?? '';
		}
		out.push(obj);
	}
	return out;
}

/** CSV to rows with RFC4180-ish quotes, commas, and newlines. */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let i = 0;
	let inQuotes = false;
	const pushCell = () => { row.push(cell); cell = ''; };
	const pushRow = () => { pushCell(); rows.push(row); row = []; };
	while (i < text.length) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
				inQuotes = false; i++; continue;
			} else { cell += ch; i++; continue; }
		} else {
			if (ch === '"') { inQuotes = true; i++; continue; }
			if (ch === ',') { pushCell(); i++; continue; }
			if (ch === '\n') { pushRow(); i++; continue; }
			if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
			cell += ch; i++;
		}
	}
	pushRow();
	if (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
	return rows;
}

