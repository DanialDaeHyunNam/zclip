/**
 * Optional shared-password gate. If APP_PASSWORD is unset, everything is open.
 * The client sends the password via the x-app-password header; <video> tags
 * can't set headers, so /api/video also accepts it as a ?pw= query param.
 */

export function passwordRequired(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function checkPassword(req: Request): boolean {
  const required = process.env.APP_PASSWORD;
  if (!required) return true;
  const given =
    req.headers.get("x-app-password") ??
    new URL(req.url).searchParams.get("pw");
  return given === required;
}

export const unauthorized = () =>
  Response.json(
    { error: "Invalid or missing password" },
    { status: 401 },
  );
