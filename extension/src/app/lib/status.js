// HTTP status classification helpers. Pure.

export function statusFamily(statusCode) {
  const code = Number(statusCode);
  if (!code) {
    return "";
  }
  return `${Math.floor(code / 100)}xx`;
}

export function isNon200HttpStatus(statusCode) {
  const code = Number(statusCode);
  return Boolean(code && code !== 200);
}
