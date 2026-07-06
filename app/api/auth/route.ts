import { checkPassword, passwordRequired } from "@/lib/auth";

/** Lets the UI know whether a password gate is active and whether the
 *  supplied credential (x-app-password header) is valid. */
export async function GET(req: Request) {
  return Response.json({
    required: passwordRequired(),
    ok: checkPassword(req),
  });
}
