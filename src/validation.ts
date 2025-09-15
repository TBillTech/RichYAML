// Lightweight schema validation for RichYAML nodes (Task 21)
// Produces friendly issue objects for !equation and !chart nodes used by inline/side previews.

export type ValidationIssue = {
  severity: 'error' | 'warning';
  message: string;
  code?: string;
  path?: Array<string | number>; // path within the node (e.g., ['encoding','x','field'])
};

export interface EquationData { latex?: any; mathjson?: any; desc?: any; }
export interface ChartData { title?: any; mark?: any; data?: any; encoding?: any; legend?: any; colors?: any; vegaLite?: any; width?: any; height?: any; }

// Validate an !equation payload (already shallow-projected by host)
export function validateEquation(eq: EquationData | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!eq) {
    issues.push({ severity: 'error', message: 'Equation node is empty', code: 'eq.empty' });
    return issues;
  }
  // Required: mathjson (object) – latex is optional
  if (eq.mathjson == null) {
    issues.push({ severity: 'error', message: 'Missing required property: mathjson', code: 'eq.missingMathjson', path: ['mathjson'] });
  } else if (typeof eq.mathjson !== 'object') {
    issues.push({ severity: 'error', message: 'mathjson must be an object', code: 'eq.mathjsonType', path: ['mathjson'] });
  }
  // Optional: latex should be string if present
  if (eq.latex != null && typeof eq.latex !== 'string') {
    issues.push({ severity: 'warning', message: 'latex should be a string (will be ignored)', code: 'eq.latexType', path: ['latex'] });
  }
  if (eq.desc != null && typeof eq.desc !== 'string') {
    issues.push({ severity: 'warning', message: 'desc should be a string', code: 'eq.descType', path: ['desc'] });
  }
  return issues;
}

// Validate a !chart payload (already shallow-projected by host)
export function validateChart(chart: ChartData | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!chart) {
    issues.push({ severity: 'error', message: 'Chart node is empty', code: 'chart.empty' });
    return issues;
  }
  // Required: title (string)
  if (!chart.title || typeof chart.title !== 'string') {
    issues.push({ severity: 'error', message: 'Missing or invalid required property: title', code: 'chart.missingTitle', path: ['title'] });
  }
  // Required: mark (allowed set)
  const allowedMarks = new Set(['line','bar','point']);
  if (!chart.mark || typeof chart.mark !== 'string') {
    issues.push({ severity: 'error', message: 'Missing required property: mark', code: 'chart.missingMark', path: ['mark'] });
  } else if (!allowedMarks.has(chart.mark.toLowerCase())) {
    issues.push({ severity: 'warning', message: `Unknown mark: ${chart.mark}`, code: 'chart.unknownMark', path: ['mark'] });
  }
  // Required: data (object with values[] or file)
  if (!chart.data || typeof chart.data !== 'object') {
    issues.push({ severity: 'error', message: 'Missing required property: data', code: 'chart.missingData', path: ['data'] });
  } else {
    const hasValues = Array.isArray(chart.data.values);
    const hasFile = typeof chart.data.file === 'string' && chart.data.file.trim().length > 0;
    if (!hasValues && !hasFile) {
      issues.push({ severity: 'error', message: 'data must have either values[] or file', code: 'chart.dataShape', path: ['data'] });
    } else if (hasValues && hasFile) {
      issues.push({ severity: 'warning', message: 'data has both values and file (values will take precedence)', code: 'chart.dataBoth', path: ['data'] });
    }
  }
  // Required: encoding.x.field & encoding.y.field for MVP spec
  if (!chart.encoding || typeof chart.encoding !== 'object') {
    issues.push({ severity: 'error', message: 'Missing required property: encoding', code: 'chart.missingEncoding', path: ['encoding'] });
  } else {
    const enc = chart.encoding;
    const x = enc.x; const y = enc.y;
    if (!x || typeof x !== 'object') {
      issues.push({ severity: 'error', message: 'Missing encoding.x object', code: 'chart.missingEncodingX', path: ['encoding','x'] });
    } else {
      if (!x.field) issues.push({ severity: 'error', message: 'encoding.x.field required', code: 'chart.missingXField', path: ['encoding','x','field'] });
      if (x.type && !isAllowedType(x.type)) issues.push({ severity: 'warning', message: `encoding.x.type unexpected: ${x.type}`, code: 'chart.xType', path: ['encoding','x','type'] });
    }
    if (!y || typeof y !== 'object') {
      issues.push({ severity: 'error', message: 'Missing encoding.y object', code: 'chart.missingEncodingY', path: ['encoding','y'] });
    } else {
      if (!y.field) issues.push({ severity: 'error', message: 'encoding.y.field required', code: 'chart.missingYField', path: ['encoding','y','field'] });
      if (y.type && !isAllowedType(y.type)) issues.push({ severity: 'warning', message: `encoding.y.type unexpected: ${y.type}`, code: 'chart.yType', path: ['encoding','y','type'] });
    }
  }
  return issues;
}

function isAllowedType(t) {
  return ['quantitative','nominal','temporal','ordinal'].includes(String(t).toLowerCase());
}

export function summarizeIssues(issues: ValidationIssue[]): { errors: number; warnings: number } {
  let errors = 0, warnings = 0;
  for (const i of issues) { if (i.severity === 'error') errors++; else warnings++; }
  return { errors, warnings };
}
