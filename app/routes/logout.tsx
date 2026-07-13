import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroySession, getSessionUser } from "../lib/auth.server";
import { writeAudit } from "../lib/audit.server";

export async function action({ request }: Route.ActionArgs) {
  const user = await getSessionUser(request);
  if (user) await writeAudit({ request, action: "auth.logout", resourceType: "session", resourceId: user.sessionId, organizationId: user.organizationId, actorUserId: user.userId });
  return redirect("/login", { headers: { "Set-Cookie": await destroySession(request) } });
}
