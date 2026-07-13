import { env } from "cloudflare:workers";
import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { getSessionUser } from "../lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const state = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if (!state?.count) throw redirect("/setup");
  throw redirect((await getSessionUser(request)) ? "/dashboard" : "/login");
}

export default function Home() {
  return null;
}
