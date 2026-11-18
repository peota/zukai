import { describe, expect, it } from "vitest";
import conf from "../src-tauri/tauri.conf.json";

/**
 * The webview's Content-Security-Policy (spec §7: nothing is fetched from a
 * CDN). Excalidraw falls back to esm.sh for fonts it can't load locally;
 * the policy must block that and any other network source.
 */
type Policy = Record<string, string>;
const security = conf.app.security as {
  csp: Policy | null;
  devCsp?: Policy | null;
};

const policies: [string, Policy | null | undefined][] = [
  ["csp", security.csp],
  ["devCsp", security.devCsp],
];

/** The sources a policy may name besides keywords and local schemes. */
const ALLOWED_HOSTS = new Set(["http://ipc.localhost", "ws://localhost:1420"]);

describe.each(policies)("%s", (name, policy) => {
  it("is set", () => {
    expect(policy, name).toBeTruthy();
    expect(policy?.["default-src"]).toBe("'self'");
    expect(policy?.["object-src"]).toBe("'none'");
    expect(policy?.["frame-src"]).toBe("'none'");
  });

  it("names no network source", () => {
    for (const [directive, value] of Object.entries(policy ?? {})) {
      for (const source of value.split(/\s+/).filter(Boolean)) {
        const where = `${name} ${directive} ${source}`;
        expect(source, where).not.toMatch(/esm\.sh|unpkg|jsdelivr/i);
        expect(source, where).not.toMatch(/^https:?/i);
        expect(source, where).not.toMatch(/^(https?|wss?):$/i);
        expect(source, where).not.toBe("*");
        expect(source, where).not.toBe("'unsafe-eval'");
        if (/^(https?|wss?):\/\//i.test(source)) {
          expect(ALLOWED_HOSTS.has(source), where).toBe(true);
        }
      }
    }
  });
});

it("the production policy allows no inline script", () => {
  expect(security.csp?.["script-src"]).not.toContain("'unsafe-inline'");
});
