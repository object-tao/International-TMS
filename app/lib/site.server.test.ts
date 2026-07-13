import { describe, expect, it } from "vitest";
import { siteFromRequest, siteHome, siteLogin } from "./site.server";

describe("site routing", () => {
  it("routes the customer subdomain to the portal", () => {
    expect(siteFromRequest(new Request("https://portal.oulingtruck.com/"))).toBe("portal");
    expect(siteHome("portal")).toBe("/portal");
    expect(siteLogin("portal")).toBe("/portal/login");
  });

  it("routes other hosts to the operations site", () => {
    expect(siteFromRequest(new Request("https://admin.oulingtruck.com/"))).toBe("admin");
    expect(siteFromRequest(new Request("https://international-tms.example.workers.dev/"))).toBe("admin");
  });
});
