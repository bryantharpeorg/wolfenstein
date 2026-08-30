/**
 * Recursively walks `root` and returns an array of violation messages for any
 * file whose extension is in the forbidden binary-asset list.
 */
export declare function walkAndReport(root: string): string[];
