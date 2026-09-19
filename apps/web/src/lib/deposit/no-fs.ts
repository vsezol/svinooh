export function readFileSync(): never {
  throw new Error('the browser has no files to read');
}

export default { readFileSync };
