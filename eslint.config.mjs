import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**"]
  },
  // paperlessAdminClient() is provisioning-only — isolation test #20 makes this a lint error.
  {
    files: ["src/**/*.{ts,tsx}", "worker/**/*.ts"],
    ignores: ["src/modules/tenants/**", "worker/jobs/provision-tenant.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/paperless/client",
              importNames: ["paperlessAdminClient"],
              message:
                "paperlessAdminClient() is for tenant provisioning only — import it from " +
                "src/modules/tenants/** or worker/jobs/provision-tenant.ts, not here. Tenant " +
                "work uses paperlessFor(orgId)."
            }
          ]
        }
      ]
    }
  }
];

export default eslintConfig;
